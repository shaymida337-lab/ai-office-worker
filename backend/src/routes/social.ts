import { Router } from "express";
import { authMiddleware } from "../lib/auth.js";
import { config } from "../lib/config.js";
import { prisma } from "../lib/prisma.js";
import {
  approvePost,
  connectSocialAccount,
  generateSocialPosts,
  getApprovalBatch,
  getSocialAccounts,
  getSocialCalendar,
  publishPost,
  rejectPost,
} from "../services/socialMedia.js";

export const socialRouter = Router();

socialRouter.get("/approval/:token", async (req, res) => {
  res.json({ posts: await getApprovalBatch(req.params.token) });
});

socialRouter.post("/approve/:postId", async (req, res) => {
  await approvePost(req.params.postId);
  res.json({ ok: true });
});

socialRouter.post("/reject/:postId", async (req, res) => {
  res.json(await rejectPost(req.params.postId));
});

socialRouter.use(authMiddleware);

socialRouter.get("/status", async (req, res) => {
  const clients = await prisma.client.findMany({
    where: { organizationId: req.auth!.organizationId, isActive: true },
    select: {
      id: true,
      name: true,
      socialAccounts: {
        select: { platform: true, isActive: true, pageId: true, updatedAt: true },
      },
    },
  });
  const platforms = ["instagram", "facebook", "linkedin"];
  const byPlatform = platforms.map((platform) => {
    const accounts = clients.flatMap((client) =>
      client.socialAccounts
        .filter((account) => account.platform === platform)
        .map((account) => ({ ...account, clientName: client.name }))
    );
    const active = accounts.filter((account) => account.isActive);
    return {
      platform,
      connected: active.length > 0,
      activeAccounts: active.length,
      totalAccounts: accounts.length,
      lastUpdatedAt: active[0]?.updatedAt ?? accounts[0]?.updatedAt ?? null,
      clients: active.map((account) => account.clientName),
    };
  });
  res.json({ platforms: byPlatform });
});

socialRouter.post("/connect/:platform", async (req, res) => {
  const body = req.body as { clientId?: string; accessToken?: string; pageId?: string };
  if (!body.clientId) {
    res.status(400).json({ error: "clientId is required" });
    return;
  }
  const allowed = await prisma.client.findFirst({ where: { id: body.clientId, organizationId: req.auth!.organizationId } });
  if (!allowed) {
    res.status(403).json({ error: "Client access denied" });
    return;
  }
  if (!body.accessToken) {
    res.json({ oauthUrl: buildOAuthUrl(req.params.platform, body.clientId), requiresOAuth: true });
    return;
  }
  res.json(await connectSocialAccount(body.clientId, req.params.platform, body));
});

socialRouter.get("/accounts/:clientId", async (req, res) => {
  await assertClient(req.params.clientId, req.auth!.organizationId);
  res.json({ accounts: await getSocialAccounts(req.params.clientId) });
});

socialRouter.post("/generate/:clientId", async (req, res) => {
  await assertClient(req.params.clientId, req.auth!.organizationId);
  res.json(await generateSocialPosts(req.params.clientId, req.auth!.organizationId));
});

socialRouter.post("/publish/:postId", async (req, res) => {
  await assertPost(req.params.postId, req.auth!.organizationId);
  res.json(await publishPost(req.params.postId));
});

socialRouter.get("/calendar/:clientId", async (req, res) => {
  await assertClient(req.params.clientId, req.auth!.organizationId);
  res.json({ posts: await getSocialCalendar(req.params.clientId) });
});

socialRouter.post("/approve-all/:token", async (req, res) => {
  const posts = await getApprovalBatch(req.params.token);
  for (const post of posts) await approvePost(post.id);
  res.json({ ok: true, approved: posts.length });
});

async function assertClient(clientId: string, organizationId: string) {
  const client = await prisma.client.findFirst({ where: { id: clientId, organizationId, isActive: true } });
  if (!client) throw new Error("Client access denied");
}

async function assertPost(postId: string, organizationId: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT p."id" FROM "SocialPost" p JOIN "Client" c ON c."id" = p."clientId" WHERE p."id" = $1 AND c."organizationId" = $2 LIMIT 1`,
    postId,
    organizationId
  );
  if (!rows[0]) throw new Error("Post access denied");
}

function buildOAuthUrl(platform: string, clientId: string) {
  const redirect = encodeURIComponent(`${config.frontendUrl}/social?clientId=${clientId}&platform=${platform}`);
  if (platform === "linkedin") {
    return `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${config.linkedin.clientId}&redirect_uri=${redirect}&scope=w_member_social%20r_basicprofile`;
  }
  return `https://www.facebook.com/v19.0/dialog/oauth?client_id=${config.facebook.appId}&redirect_uri=${redirect}&scope=instagram_basic,pages_manage_posts,instagram_content_publish`;
}
