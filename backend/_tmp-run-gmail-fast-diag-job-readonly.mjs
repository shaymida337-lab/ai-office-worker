/**
 * READ-ONLY: create a Render one-off job that runs Gmail fast-query diagnosis
 * using production getGoogleClients (same OAuth path as live scans).
 * No app code changes. No Commit/Push.
 */
import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const SERVICE_ID = process.env.RENDER_SERVICE_ID ?? "srv-d898po77f7vs73bu01v0";
const ORG_ID = "cmpjd7j7e0001bl5tzv049rxb";
const apiKey = process.env.RENDER_API_KEY?.trim();
if (!apiKey) {
  console.error(JSON.stringify({ error: "RENDER_API_KEY missing" }));
  process.exit(2);
}

// Compact diagnostic script executed on Render (CJS, uses dist + googleapis).
const remoteScript = `
const ORG=${JSON.stringify(ORG_ID)};
(async()=>{
  const { getGoogleClients } = require('./dist/services/google.js');
  const { buildFastScanQueries, FAST_SCAN_DATE_FILTER } = require('./dist/services/gmailFastScanQuery.js');
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  function headersOf(payload){
    const out={};
    for (const h of payload?.headers||[]) if(h?.name) out[String(h.name).toLowerCase()]=h.value;
    return out;
  }
  function atts(payload, acc=[]){
    if(!payload) return acc;
    if(payload.filename || payload.body?.attachmentId){
      acc.push({filename:payload.filename||null,mimeType:payload.mimeType||null,size:payload.body?.size??null});
    }
    for (const p of payload.parts||[]) atts(p, acc);
    return acc;
  }
  async function list(gmail,q){
    const r=await gmail.users.messages.list({userId:'me', q, maxResults:50});
    return {query:q, count:(r.data.messages||[]).length, estimate:r.data.resultSizeEstimate??null, ids:(r.data.messages||[]).map(m=>m.id).filter(Boolean)};
  }
  async function describe(gmail,id){
    const r=await gmail.users.messages.get({userId:'me', id, format:'full'});
    const h=headersOf(r.data.payload);
    const labelIds=r.data.labelIds||[];
    return {
      id,
      receivedAt:r.data.internalDate?new Date(Number(r.data.internalDate)).toISOString():null,
      sender:h.from||null,
      to:h.to||null,
      subject:h.subject||null,
      labelIds,
      inSpam:labelIds.includes('SPAM'),
      inTrash:labelIds.includes('TRASH'),
      inInbox:labelIds.includes('INBOX'),
      inSent:labelIds.includes('SENT'),
      categoryPromotions:labelIds.includes('CATEGORY_PROMOTIONS'),
      categorySocial:labelIds.includes('CATEGORY_SOCIAL'),
      categoryUpdates:labelIds.includes('CATEGORY_UPDATES'),
      attachments:atts(r.data.payload).filter(a=>a.filename || (a.mimeType&&(a.mimeType.startsWith('image/')||a.mimeType.startsWith('application/'))))
    };
  }
  try {
    const { gmail } = await getGoogleClients(ORG);
    const profile = await gmail.users.getProfile({userId:'me'});
    const fast = buildFastScanQueries();
    const extra = [
      'newer_than:1d has:attachment',
      'newer_than:1d has:attachment -in:spam -in:trash',
      'newer_than:1d',
      'newer_than:1d in:inbox',
      'newer_than:1d in:sent has:attachment',
      'newer_than:1d filename:pdf',
      'newer_than:1d (filename:pdf OR filename:jpg OR filename:jpeg OR filename:png)',
      'newer_than:1d subject:חשבונית',
      'newer_than:1d subject:invoice',
      'newer_than:2d has:attachment -in:spam -in:trash',
      'after:2026/07/25 has:attachment -in:spam -in:trash'
    ];
    const queryResults=[];
    for (const q of [...fast, ...extra]) {
      try { queryResults.push(await list(gmail,q)); }
      catch(e){ queryResults.push({query:q, count:0, ids:[], error:String(e&&e.message||e)}); }
    }
    const ids=[...new Set(queryResults.flatMap(r=>r.ids||[]))].slice(0,40);
    const messages=[];
    for (const id of ids) messages.push(await describe(gmail,id));
    messages.sort((a,b)=>String(b.receivedAt).localeCompare(String(a.receivedAt)));
    const since3h=Date.now()-3*3600e3;
    const since6h=Date.now()-6*3600e3;
    const withAtt=m=> (m.attachments||[]).length>0;
    const recent3=messages.filter(m=>m.receivedAt && new Date(m.receivedAt).getTime()>=since3h && withAtt(m));
    const recent6=messages.filter(m=>m.receivedAt && new Date(m.receivedAt).getTime()>=since6h && withAtt(m));
    const gids=messages.map(m=>m.id);
    const gsi = gids.length ? await prisma.gmailScanItem.findMany({where:{organizationId:ORG, gmailMessageId:{in:gids}}, select:{id:true,gmailMessageId:true,reviewStatus:true,decisionReason:true,attachmentFilename:true,createdAt:true}}) : [];
    const fdr = gids.length ? await prisma.financialDocumentReview.findMany({where:{organizationId:ORG, gmailMessageId:{in:gids}}, select:{id:true,gmailMessageId:true,reviewStatus:true,uncertaintyReason:true,fileName:true,createdAt:true}}) : [];
    const broad=queryResults.find(r=>r.query==='newer_than:1d has:attachment');
    const fastPrimary=queryResults.find(r=>r.query===FAST_SCAN_DATE_FILTER+' has:attachment -in:spam -in:trash');
    console.log('GMAIL_FAST_DIAG_BEGIN');
    console.log(JSON.stringify({
      now:new Date().toISOString(),
      mailboxEmail:profile.data.emailAddress||null,
      fastScanDateFilter:FAST_SCAN_DATE_FILTER,
      fastQueries:fast,
      queryResults:queryResults.map(r=>({query:r.query,count:r.count,estimate:r.estimate??null,error:r.error||null,sampleIds:(r.ids||[]).slice(0,5)})),
      fastPrimaryVsBroad:{
        fastPrimaryQuery:fastPrimary&&fastPrimary.query||null,
        fastPrimaryCount:fastPrimary&&fastPrimary.count||0,
        broadQuery:broad&&broad.query||null,
        broadCount:broad&&broad.count||0,
        onlyInBroadNotFast:(broad&&broad.ids||[]).filter(id=>!(fastPrimary&&fastPrimary.ids||[]).includes(id))
      },
      recentWithAttachmentsLast3h:recent3,
      recentWithAttachmentsLast6h:recent6,
      newest15:messages.slice(0,15),
      alreadyInDb:{gsi,fdr}
    }));
    console.log('GMAIL_FAST_DIAG_END');
  } catch(e) {
    console.log('GMAIL_FAST_DIAG_ERROR '+String(e&&e.stack||e));
    process.exitCode=1;
  } finally {
    await prisma.$disconnect();
  }
})();
`.trim();

const startCommand = `node -e ${JSON.stringify(remoteScript)}`;

const headers = {
  Authorization: `Bearer ${apiKey}`,
  Accept: "application/json",
  "Content-Type": "application/json",
};

async function main() {
  console.log("creating_render_job…");
  const create = await fetch(`https://api.render.com/v1/services/${SERVICE_ID}/jobs`, {
    method: "POST",
    headers,
    body: JSON.stringify({ startCommand }),
    signal: AbortSignal.timeout(30_000),
  });
  const createText = await create.text();
  if (!create.ok) {
    throw new Error(`job_create_failed ${create.status} ${createText.slice(0, 800)}`);
  }
  const created = JSON.parse(createText);
  const jobId = created.id ?? created.job?.id;
  if (!jobId) throw new Error(`no job id: ${createText.slice(0, 300)}`);
  console.log(JSON.stringify({ jobId, status: "created" }));

  let status = "";
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    const st = await fetch(`https://api.render.com/v1/services/${SERVICE_ID}/jobs/${jobId}`, {
      headers,
      signal: AbortSignal.timeout(20_000),
    });
    const body = await st.json();
    status = body.status ?? body.job?.status ?? "";
    console.log(JSON.stringify({ poll: i, status }));
    if (["succeeded", "failed", "canceled", "cancelled"].includes(String(status).toLowerCase())) break;
  }

  const logUrls = [
    `https://api.render.com/v1/jobs/${jobId}/logs`,
    `https://api.render.com/v1/services/${SERVICE_ID}/jobs/${jobId}/logs`,
  ];
  let logs = "";
  for (const url of logUrls) {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(60_000) });
    console.log(JSON.stringify({ logsUrl: url, http: res.status }));
    if (res.ok) {
      logs = await res.text();
      break;
    }
  }

  // Also try owner logs filtered by time around job
  if (!logs.includes("GMAIL_FAST_DIAG")) {
    const owner = "tea-d86903gg4nts73abte2g";
    const end = new Date();
    const start = new Date(Date.now() - 20 * 60 * 1000);
    const url =
      `https://api.render.com/v1/logs?ownerId=${owner}&resource=${SERVICE_ID}` +
      `&limit=100&direction=backward` +
      `&startTime=${encodeURIComponent(start.toISOString())}` +
      `&endTime=${encodeURIComponent(end.toISOString())}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } });
    if (res.ok) {
      const payload = await res.json();
      const lines = (payload.logs ?? []).map((e) => e.message ?? "").filter(Boolean);
      logs = lines.join("\n");
    }
  }

  writeFileSync(join(process.cwd(), "_tmp-gmail-fast-query-job-logs.txt"), logs, "utf8");
  const begin = logs.indexOf("GMAIL_FAST_DIAG_BEGIN");
  const end = logs.indexOf("GMAIL_FAST_DIAG_END");
  if (begin >= 0 && end > begin) {
    const jsonText = logs.slice(begin + "GMAIL_FAST_DIAG_BEGIN".length, end).trim();
    writeFileSync(join(process.cwd(), "_tmp-gmail-fast-query-diag.json"), jsonText, "utf8");
    console.log("WROTE_DIAG_JSON");
    console.log(jsonText.slice(0, 2000));
  } else {
    console.log("NO_DIAG_MARKERS");
    console.log(logs.slice(0, 3000));
  }
}

main().catch((e) => {
  console.error(JSON.stringify({ error: String(e?.message ?? e) }));
  process.exit(1);
});
