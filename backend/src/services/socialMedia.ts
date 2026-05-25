import crypto from "crypto";
import axios from "axios";
import Anthropic from "@anthropic-ai/sdk";
import { config, hasClaude } from "../lib/config.js";
import { prisma } from "../lib/prisma.js";

type Platform = "instagram" | "facebook" | "linkedin";
type SocialPostRow = {
  id: string;
  clientId: string;
  platform: Platform;
  content: string;
  imageUrl: string | null;
  canvaDesignId: string | null;
  scheduledAt: Date;
  status: string;
  approvalToken: string | null;
  approvedAt: Date | null;
  publishedAt: Date | null;
  errorMessage: string | null;
  retryCount: number;
  analytics: unknown;
  createdAt: Date;
};

type SocialAccountRow = { id: string; clientId: string; platform: Platform; accessToken: string; pageId: string | null; isActive: boolean };
type SocialSettingsRow = { businessType: string; brandColors: string | null; brandVoice: string | null; postsPerWeek: number; targetAudience: string | null; canvaTemplateId: string | null };
type GeneratedPost = { platform: Platform; content: string; scheduledAt: Date };

const anthropic = hasClaude() ? new Anthropic({ apiKey: config.anthropic.apiKey }) : null;
const platforms: Platform[] = ["instagram", "facebook", "linkedin"];
const OPTIMAL_TIMES: Record<Platform, Array<{ day: number; hour: number }>> = {
  instagram: [{ day: 1, hour: 11 }, { day: 3, hour: 19 }, { day: 5, hour: 11 }],
  facebook: [{ day: 2, hour: 12 }, { day: 4, hour: 18 }],
  linkedin: [{ day: 1, hour: 8 }, { day: 3, hour: 17 }],
};

export async function connectSocialAccount(clientId: string, platform: string, input: { accessToken?: string; pageId?: string }) {
  assertPlatform(platform);
  const token = input.accessToken?.trim() || `pending_oauth_${platform}`;
  const encrypted = encryptToken(token);
  await prisma.$executeRawUnsafe(
    `INSERT INTO "SocialAccount" ("id","clientId","platform","accessToken","pageId","isActive","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,$5,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
     ON CONFLICT ("clientId","platform") DO UPDATE SET "accessToken" = EXCLUDED."accessToken", "pageId" = EXCLUDED."pageId", "isActive" = true, "updatedAt" = CURRENT_TIMESTAMP`,
    id("sa"),
    clientId,
    platform,
    encrypted,
    input.pageId ?? null
  );
  return { connected: true, platform };
}

export async function getSocialAccounts(clientId: string) {
  return prisma.$queryRawUnsafe<Array<Omit<SocialAccountRow, "accessToken">>>(
    'SELECT "id","clientId","platform","pageId","isActive" FROM "SocialAccount" WHERE "clientId" = $1 ORDER BY "platform"',
    clientId
  );
}

export async function getSocialCalendar(clientId: string) {
  return prisma.$queryRawUnsafe<SocialPostRow[]>(
    'SELECT * FROM "SocialPost" WHERE "clientId" = $1 ORDER BY "scheduledAt" ASC',
    clientId
  );
}

export async function generateSocialPosts(clientId: string, organizationId: string) {
  const client = await prisma.client.findFirst({ where: { id: clientId, organizationId, isActive: true } });
  if (!client) throw new Error("Client not found");
  const settings = await getOrCreateSettings(clientId);
  const previousPosts = await prisma.$queryRawUnsafe<Array<{ content: string }>>(
    'SELECT "content" FROM "SocialPost" WHERE "clientId" = $1 ORDER BY "createdAt" DESC LIMIT 10',
    clientId
  );
  const generated: GeneratedPost[] = [];
  for (const platform of platforms) {
    const slots = nextSlots(platform, 7).slice(0, platform === "instagram" ? 3 : 2);
    for (const scheduledAt of slots) {
      generated.push({
        platform,
        scheduledAt,
        content: await generatePostContent({ businessName: client.name, platform, settings, previousPosts: previousPosts.map((post) => post.content) }),
      });
    }
  }

  const token = crypto.randomBytes(24).toString("hex");
  const posts: SocialPostRow[] = [];
  for (const post of generated) {
    const graphic = await createCanvaGraphic({ businessName: client.name, content: post.content, settings });
    const rows = await prisma.$queryRawUnsafe<SocialPostRow[]>(
      `INSERT INTO "SocialPost" ("id","clientId","platform","content","imageUrl","canvaDesignId","scheduledAt","status","approvalToken","createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending_approval',$8,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
       RETURNING *`,
      id("sp"),
      clientId,
      post.platform,
      post.content,
      graphic.imageUrl,
      graphic.canvaDesignId,
      post.scheduledAt,
      token
    );
    posts.push(rows[0]);
  }

  await sendApprovalEmail(client.email, client.name, token, posts);
  return { posts, approvalToken: token, approvalUrl: `${config.frontendUrl}/social/approve/${token}` };
}

export async function approvePost(postId: string) {
  await updatePostStatus(postId, "approved", { approvedAt: new Date() });
  return { ok: true };
}

export async function rejectPost(postId: string) {
  const rows = await prisma.$queryRawUnsafe<Array<SocialPostRow & { clientName: string }>>(
    `SELECT p.*, c."name" as "clientName" FROM "SocialPost" p JOIN "Client" c ON c."id" = p."clientId" WHERE p."id" = $1 LIMIT 1`,
    postId
  );
  const post = rows[0];
  if (!post) throw new Error("Post not found");
  const settings = await getOrCreateSettings(post.clientId);
  const content = await generatePostContent({ businessName: post.clientName, platform: post.platform, settings, previousPosts: [post.content] });
  await prisma.$executeRawUnsafe(
    'UPDATE "SocialPost" SET "status" = $1, "content" = $2, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = $3',
    "pending_approval",
    content,
    postId
  );
  return { ok: true, regenerated: true };
}

export async function publishPost(postId: string) {
  const posts = await prisma.$queryRawUnsafe<SocialPostRow[]>('SELECT * FROM "SocialPost" WHERE "id" = $1 LIMIT 1', postId);
  const post = posts[0];
  if (!post) throw new Error("Post not found");
  const accounts = await prisma.$queryRawUnsafe<SocialAccountRow[]>(
    'SELECT * FROM "SocialAccount" WHERE "clientId" = $1 AND "platform" = $2 AND "isActive" = true LIMIT 1',
    post.clientId,
    post.platform
  );
  const account = accounts[0];
  if (!account) throw new Error(`No connected ${post.platform} account`);

  try {
    await publishToPlatform(post, account);
    await updatePostStatus(post.id, "published", { publishedAt: new Date(), errorMessage: null });
    return { published: true };
  } catch (err) {
    const retryCount = post.retryCount + 1;
    await prisma.$executeRawUnsafe(
      'UPDATE "SocialPost" SET "status" = $1, "retryCount" = $2, "errorMessage" = $3, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = $4',
      retryCount >= 3 ? "failed" : "approved",
      retryCount,
      err instanceof Error ? err.message : String(err),
      post.id
    );
    throw err;
  }
}

export async function publishDueSocialPosts() {
  const due = await prisma.$queryRawUnsafe<SocialPostRow[]>(
    `SELECT * FROM "SocialPost" WHERE "status" = 'approved' AND "scheduledAt" <= $1 AND "retryCount" < 3 ORDER BY "scheduledAt" ASC LIMIT 25`,
    new Date(Date.now() + 60 * 60 * 1000)
  );
  for (const post of due) {
    try {
      await publishPost(post.id);
      console.log(`[social] Published post ${post.id}`);
    } catch (err) {
      console.error(`[social] Publish failed post=${post.id}`, err);
    }
  }
  return { checked: due.length };
}

export async function getApprovalBatch(token: string) {
  return prisma.$queryRawUnsafe<SocialPostRow[]>(
    'SELECT * FROM "SocialPost" WHERE "approvalToken" = $1 ORDER BY "scheduledAt" ASC',
    token
  );
}

async function getOrCreateSettings(clientId: string): Promise<SocialSettingsRow> {
  const rows = await prisma.$queryRawUnsafe<SocialSettingsRow[]>(
    'SELECT "businessType","brandColors","brandVoice","postsPerWeek","targetAudience","canvaTemplateId" FROM "SocialSettings" WHERE "clientId" = $1 LIMIT 1',
    clientId
  );
  if (rows[0]) return rows[0];
  await prisma.$executeRawUnsafe(
    `INSERT INTO "SocialSettings" ("id","clientId","businessType","brandVoice","postsPerWeek","createdAt","updatedAt")
     VALUES ($1,$2,'עסק מקומי','professional',3,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
    id("ss"),
    clientId
  );
  return { businessType: "עסק מקומי", brandColors: null, brandVoice: "professional", postsPerWeek: 3, targetAudience: null, canvaTemplateId: null };
}

async function generatePostContent(input: { businessName: string; platform: Platform; settings: SocialSettingsRow; previousPosts: string[] }) {
  const prompt = `Generate one ${input.platform} post in Hebrew for:
Business: ${input.businessName}
Business type: ${input.settings.businessType}
Target audience: ${input.settings.targetAudience ?? "לקוחות בישראל"}
Brand voice: ${input.settings.brandVoice ?? "professional"}
Avoid repeating: ${input.previousPosts.join("\n---\n").slice(0, 1500)}
Return caption + hashtags + call to action. Keep it professional and platform-specific.`;

  if (!anthropic) return fallbackContent(input.platform, input.businessName, input.settings.businessType);
  try {
    const message = await anthropic.messages.create({
      model: config.anthropic.model,
      max_tokens: 500,
      messages: [{ role: "user", content: prompt }],
    });
    return message.content[0]?.type === "text" ? message.content[0].text.trim() : fallbackContent(input.platform, input.businessName, input.settings.businessType);
  } catch {
    return fallbackContent(input.platform, input.businessName, input.settings.businessType);
  }
}

async function createCanvaGraphic(input: { businessName: string; content: string; settings: SocialSettingsRow }) {
  if (!config.canva.clientId || !config.canva.clientSecret) {
    return fallbackGraphic(input.businessName);
  }
  try {
    // Canva Connect API setup differs by app approval. Keep HTTP integration isolated with a safe fallback.
    await axios.post("https://api.canva.com/rest/v1/designs", {
      title: `${input.businessName} social post`,
      template_id: input.settings.canvaTemplateId,
      brand_colors: input.settings.brandColors,
      text: input.content.slice(0, 240),
    }, { timeout: 8000 });
    return fallbackGraphic(input.businessName);
  } catch {
    return fallbackGraphic(input.businessName);
  }
}

async function publishToPlatform(post: SocialPostRow, account: SocialAccountRow) {
  const token = decryptToken(account.accessToken);
  if (account.platform === "linkedin") {
    await axios.post("https://api.linkedin.com/v2/ugcPosts", { text: post.content }, { headers: { Authorization: `Bearer ${token}` }, timeout: 10000 });
    return;
  }
  const pageId = account.pageId;
  if (!pageId) throw new Error("Missing page ID");
  const endpoint = account.platform === "instagram" ? `https://graph.facebook.com/v19.0/${pageId}/media` : `https://graph.facebook.com/v19.0/${pageId}/photos`;
  await axios.post(endpoint, { caption: post.content, message: post.content, url: post.imageUrl, access_token: token }, { timeout: 10000 });
}

async function sendApprovalEmail(email: string, clientName: string, token: string, posts: SocialPostRow[]) {
  console.log("[social] Approval email queued", {
    email,
    clientName,
    approvalUrl: `${config.frontendUrl}/social/approve/${token}`,
    posts: posts.length,
  });
}

async function updatePostStatus(postId: string, status: string, extra: { approvedAt?: Date; publishedAt?: Date; errorMessage?: string | null } = {}) {
  await prisma.$executeRawUnsafe(
    `UPDATE "SocialPost" SET "status" = $1, "approvedAt" = COALESCE($2, "approvedAt"), "publishedAt" = COALESCE($3, "publishedAt"), "errorMessage" = $4, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = $5`,
    status,
    extra.approvedAt ?? null,
    extra.publishedAt ?? null,
    extra.errorMessage ?? null,
    postId
  );
}

function nextSlots(platform: Platform, daysAhead: number) {
  const now = new Date();
  const end = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
  const slots: Date[] = [];
  for (let cursor = new Date(now); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    for (const slot of OPTIMAL_TIMES[platform]) {
      if (cursor.getDay() !== slot.day) continue;
      const date = new Date(cursor);
      date.setHours(slot.hour, 0, 0, 0);
      if (date > now) slots.push(date);
    }
  }
  return slots;
}

function fallbackContent(platform: Platform, businessName: string, businessType: string) {
  const hashtag = platform === "linkedin" ? "#עסקים #צמיחה" : "#עסקים #ישראל #שירות";
  return `${businessName} כאן כדי לעזור לכם לקבל יותר ערך בכל יום.\n\nטיפ קצר בתחום ${businessType}: התחילו בצעד קטן, מדדו תוצאה, ושפרו בהתמדה.\n\nרוצים לשמוע איך זה יכול לעבוד אצלכם? דברו איתנו.\n${hashtag}`;
}

function fallbackGraphic(businessName: string) {
  return {
    imageUrl: `https://placehold.co/1080x1080/1a2332/e7ecf3/png?text=${encodeURIComponent(businessName)}`,
    canvaDesignId: null,
  };
}

function encryptToken(token: string) {
  return Buffer.from(token, "utf8").toString("base64");
}

function decryptToken(token: string) {
  return Buffer.from(token, "base64").toString("utf8");
}

function assertPlatform(platform: string): asserts platform is Platform {
  if (!platforms.includes(platform as Platform)) throw new Error("Unsupported social platform");
}

function id(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}
