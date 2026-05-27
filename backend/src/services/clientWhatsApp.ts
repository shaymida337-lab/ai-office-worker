import { Readable } from "node:stream";
import { prisma } from "../lib/prisma.js";
import { extractInvoiceData } from "./invoiceExtractor.js";
import { ensureDriveFolder, safeFolderName } from "./driveService.js";
import { getGoogleClientsForClient } from "./google.js";
import { logInvoiceToSheets } from "./clientSheetsService.js";
import { config } from "../lib/config.js";

type WhatsAppRuntimeClient = {
  on(event: string, handler: (...args: any[]) => void): void;
  initialize(): Promise<void> | void;
  destroy(): Promise<void>;
  getChats(): Promise<Array<{ fetchMessages(args: { limit: number }): Promise<WhatsAppRuntimeMessage[]> }>>;
};

type WhatsAppRuntimeMessage = {
  id?: { id?: string };
  body: string;
  from: string;
  to?: string;
  timestamp: number;
};

type MessageAnalysis = {
  hasInvoice: boolean;
  hasTasks: boolean;
  tasks: string[];
  isImportant: boolean;
  summary: string;
};

class ClientWhatsAppService {
  private clients = new Map<string, WhatsAppRuntimeClient>();

  async initializeClient(clientId: string): Promise<{ qrCode?: string; status: string }> {
    const [{ Client, LocalAuth }, qrcode] = await Promise.all([
      import("whatsapp-web.js"),
      import("qrcode"),
    ]);
    const existing = this.clients.get(clientId);
    if (existing) return { status: "connected" };

    const client = new Client({
      authStrategy: new LocalAuth({ clientId: `client_${clientId}`, dataPath: "./whatsapp-sessions" }),
      puppeteer: {
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--single-process"],
      },
    }) as unknown as WhatsAppRuntimeClient;

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (value: { qrCode?: string; status: string }) => {
        if (!settled) {
          settled = true;
          resolve(value);
        }
      };
      client.on("qr", async (qr: string) => {
        finish({ qrCode: await qrcode.toDataURL(qr), status: "qr_ready" });
      });
      client.on("ready", async () => {
        this.clients.set(clientId, client);
        await upsertClientWhatsApp(clientId, { isConnected: true });
        finish({ status: "connected" });
      });
      client.on("message", (msg: WhatsAppRuntimeMessage) => {
        this.processMessage(clientId, msg).catch((err) => console.error("[clientWhatsApp] message processing failed", err));
      });
      client.on("disconnected", async () => {
        this.clients.delete(clientId);
        await upsertClientWhatsApp(clientId, { isConnected: false });
      });
      Promise.resolve(client.initialize()).catch(reject);
      setTimeout(() => finish({ status: "initializing" }), 25000);
    });
  }

  async processMessage(clientId: string, msg: WhatsAppRuntimeMessage) {
    const clientRecord = await prisma.client.findUnique({ where: { id: clientId } });
    if (!clientRecord) throw new Error("Client not found");
    const body = msg.body ?? "";
    const timestamp = new Date((msg.timestamp || Math.floor(Date.now() / 1000)) * 1000);
    const savedId = await createWhatsAppMessage({
      clientId,
      from: msg.from,
      to: msg.to ?? null,
      body,
      timestamp,
    });
    const analysis = await this.analyzeMessage(body);
    let invoiceId: string | null = null;
    let taskId: string | null = null;

    if (analysis.hasInvoice) {
      const invoice = await extractInvoiceData(body, "WhatsApp", [], { name: clientRecord.name, email: clientRecord.email });
      const created = await prisma.invoice.create({
        data: {
          organizationId: clientRecord.organizationId,
          clientId,
          invoiceNumber: invoice.invoiceNumber ?? `wa-${savedId.slice(-8)}`,
          amount: invoice.amount,
          currency: invoice.currency,
          date: new Date(invoice.date),
          dueDate: invoice.dueDate ? new Date(invoice.dueDate) : null,
          status: invoice.status,
          description: invoice.description ?? analysis.summary,
          emailId: `whatsapp:${savedId}`,
        },
      });
      invoiceId = created.id;
      const driveUrl = await saveWhatsAppInvoiceToDrive(clientId, body, invoice).catch(() => null);
      await logInvoiceToSheets(clientId, {
        invoiceNumber: invoice.invoiceNumber,
        clientName: invoice.clientName ?? clientRecord.name,
        description: invoice.description ?? analysis.summary,
        amount: invoice.amount,
        currency: invoice.currency,
        date: new Date(invoice.date),
        dueDate: invoice.dueDate ? new Date(invoice.dueDate) : null,
        status: invoice.status,
      }, driveUrl).catch(() => undefined);
    }

    if (analysis.hasTasks) {
      for (const title of analysis.tasks) {
        const task = await prisma.task.create({
          data: { organizationId: clientRecord.organizationId, clientId, title, source: "whatsapp", status: "todo", priority: "medium" },
        });
        taskId ??= task.id;
      }
    }

    await markWhatsAppMessageProcessed(savedId, { hasInvoice: analysis.hasInvoice, hasTask: analysis.hasTasks, invoiceId, taskId });
    await upsertClientWhatsApp(clientId, { lastSyncAt: new Date(), incrementScanned: 1 });
    return { id: savedId, analysis };
  }

  async analyzeMessage(text: string): Promise<MessageAnalysis> {
    const invoice = /חשבונית|invoice|receipt|תשלום|payment|סכום|amount|₪|\$|קבלה/i.test(text);
    const tasks = extractTasks(text);
    return { hasInvoice: invoice, hasTasks: tasks.length > 0, tasks, isImportant: invoice || tasks.length > 0, summary: text.slice(0, 160) };
  }

  async scanHistory(clientId: string, daysBack = 30) {
    const client = this.clients.get(clientId);
    if (!client) throw new Error("Client not connected");
    const since = Date.now() - daysBack * 24 * 60 * 60 * 1000;
    let processed = 0;
    for (const chat of await client.getChats()) {
      for (const msg of await chat.fetchMessages({ limit: 100 })) {
        if (msg.timestamp * 1000 < since || msg.body.length < 10) continue;
        await this.processMessage(clientId, msg);
        processed++;
      }
    }
    return { processed };
  }

  async getStatus(clientId: string) {
    const rows = await prisma.$queryRawUnsafe<Array<{ phoneNumber: string | null; isConnected: boolean; lastSyncAt: Date | null; messagesScanned: number }>>(
      'SELECT "phoneNumber", "isConnected", "lastSyncAt", "messagesScanned" FROM "ClientWhatsApp" WHERE "clientId" = $1 LIMIT 1',
      clientId
    );
    return rows[0] ?? { phoneNumber: null, isConnected: this.clients.has(clientId), lastSyncAt: null, messagesScanned: 0 };
  }

  async disconnect(clientId: string) {
    const client = this.clients.get(clientId);
    if (client) await client.destroy();
    this.clients.delete(clientId);
    await upsertClientWhatsApp(clientId, { isConnected: false });
  }
}

async function saveWhatsAppInvoiceToDrive(clientId: string, body: string, invoice: { invoiceNumber: string | null; date: string }) {
  const { drive, client } = await getGoogleClientsForClient(clientId);
  const root = await ensureDriveFolder(drive, config.driveRootFolder);
  const folder = await ensureDriveFolder(drive, safeFolderName(client.name), root);
  const upload = await drive.files.create({
    requestBody: { name: `whatsapp_${invoice.invoiceNumber ?? Date.now()}_${invoice.date}.txt`, parents: [folder] },
    media: { mimeType: "text/plain", body: Readable.from(Buffer.from(body, "utf8")) },
    fields: "id, webViewLink",
  });
  return upload.data.webViewLink ?? null;
}

function extractTasks(text: string) {
  if (!/לעשות|צריך|תזכיר|reminder|task|משימה|deadline|תאריך יעד|follow up/i.test(text)) return [];
  return text.split(/\n|\.|;|,/).map((item) => item.trim()).filter(Boolean).slice(0, 5);
}

async function createWhatsAppMessage(input: { clientId: string; from: string; to: string | null; body: string; timestamp: Date }) {
  const id = `wam_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  await prisma.$executeRawUnsafe(
    'INSERT INTO "WhatsAppMessage" ("id","clientId","from","to","body","timestamp","processed") VALUES ($1,$2,$3,$4,$5,$6,false)',
    id, input.clientId, input.from, input.to, input.body, input.timestamp
  );
  return id;
}

async function markWhatsAppMessageProcessed(id: string, input: { hasInvoice: boolean; hasTask: boolean; invoiceId: string | null; taskId: string | null }) {
  await prisma.$executeRawUnsafe(
    'UPDATE "WhatsAppMessage" SET "processed"=true, "hasInvoice"=$1, "hasTask"=$2, "invoiceId"=$3, "taskId"=$4 WHERE "id"=$5',
    input.hasInvoice, input.hasTask, input.invoiceId, input.taskId, id
  );
}

async function upsertClientWhatsApp(clientId: string, input: { isConnected?: boolean; lastSyncAt?: Date; incrementScanned?: number }) {
  await prisma.$executeRawUnsafe(
    'INSERT INTO "ClientWhatsApp" ("id","clientId","isConnected","lastSyncAt","messagesScanned","updatedAt") VALUES ($1,$2,$3,$4,$5,CURRENT_TIMESTAMP) ON CONFLICT ("clientId") DO UPDATE SET "isConnected"=COALESCE($3,"ClientWhatsApp"."isConnected"), "lastSyncAt"=COALESCE($4,"ClientWhatsApp"."lastSyncAt"), "messagesScanned"="ClientWhatsApp"."messagesScanned"+$5, "updatedAt"=CURRENT_TIMESTAMP',
    `cwa_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    clientId,
    input.isConnected ?? null,
    input.lastSyncAt ?? null,
    input.incrementScanned ?? 0
  );
}

export const clientWhatsApp = new ClientWhatsAppService();
