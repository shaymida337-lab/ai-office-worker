"use client";

import { useEffect, useState } from "react";
import { Nav } from "@/components/Nav";
import { apiFetch } from "@/lib/api";

type ClientItem = { id: string; name: string; email: string };
type SocialAccount = { id: string; platform: string; pageId: string | null; isActive: boolean };
type SocialPost = {
  id: string;
  platform: string;
  content: string;
  imageUrl: string | null;
  scheduledAt: string;
  status: string;
  approvalToken: string | null;
  publishedAt: string | null;
  analytics?: { likes?: number; comments?: number; reach?: number } | null;
};

const platforms = ["instagram", "facebook", "linkedin"];

export default function SocialPage() {
  const [clients, setClients] = useState<ClientItem[]>([]);
  const [clientId, setClientId] = useState("");
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [tab, setTab] = useState<"calendar" | "pending" | "analytics">("calendar");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function load() {
    const data = await apiFetch<{ clients: ClientItem[] }>("/api/clients");
    setClients(data.clients);
    const nextClientId = clientId || data.clients[0]?.id || "";
    if (nextClientId) {
      setClientId(nextClientId);
      const [accountData, calendarData] = await Promise.all([
        apiFetch<{ accounts: SocialAccount[] }>(`/api/social/accounts/${nextClientId}`),
        apiFetch<{ posts: SocialPost[] }>(`/api/social/calendar/${nextClientId}`),
      ]);
      setAccounts(accountData.accounts);
      setPosts(calendarData.posts);
    }
  }

  useEffect(() => {
    load().catch((err) => setMessage(err instanceof Error ? err.message : "טעינת סושיאל נכשלה"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  async function connect(platform: string) {
    if (!clientId) return;
    const accessToken = window.prompt(`הדבק access token עבור ${platform}`);
    const pageId = window.prompt("Page ID / Instagram Business ID / LinkedIn author ID") || "";
    const result = await apiFetch<{ oauthUrl?: string; connected?: boolean }>(`/api/social/connect/${platform}`, {
      method: "POST",
      body: JSON.stringify({ clientId, accessToken, pageId }),
    });
    if (result.oauthUrl && !accessToken) window.location.href = result.oauthUrl;
    setMessage(result.connected ? `${platform} חובר בהצלחה` : `פתח OAuth עבור ${platform}`);
    await load();
  }

  async function generate() {
    if (!clientId) return;
    setLoading(true);
    setMessage("יוצר 7 ימים של תוכן ומכין אישור לקוח...");
    try {
      const result = await apiFetch<{ posts: SocialPost[]; approvalUrl: string }>(`/api/social/generate/${clientId}`, { method: "POST" });
      setMessage(`נוצרו ${result.posts.length} פוסטים. קישור אישור: ${result.approvalUrl}`);
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "יצירת תוכן נכשלה");
    } finally {
      setLoading(false);
    }
  }

  async function postAction(postId: string, action: "approve" | "reject" | "publish") {
    await apiFetch(`/api/social/${action}/${postId}`, { method: "POST" });
    await load();
  }

  const shownPosts = tab === "pending" ? posts.filter((post) => post.status === "pending_approval") : posts;
  const connected = new Set(accounts.filter((account) => account.isActive).map((account) => account.platform));

  return (
    <div className="container">
      <h1>מנהל סושיאל AI</h1>
      <Nav />
      {message && <p>{message}</p>}
      <div className="card">
        <label>
          לקוח
          <select value={clientId} onChange={(e) => setClientId(e.target.value)} style={{ marginRight: "0.5rem" }}>
            {clients.map((client) => <option value={client.id} key={client.id}>{client.name}</option>)}
          </select>
        </label>
        <button className="btn" onClick={generate} disabled={loading || !clientId} style={{ marginRight: "0.75rem" }}>
          {loading ? "יוצר תוכן..." : "Generate new content"}
        </button>
      </div>

      <div className="card">
        <h2>חשבונות מחוברים</h2>
        <div className="grid">
          {platforms.map((platform) => (
            <div className="card" key={platform}>
              <h3>{platformIcon(platform)} {platform}</h3>
              <p>{connected.has(platform) ? "✅ מחובר" : "לא מחובר"}</p>
              <button className="btn btn-secondary" onClick={() => connect(platform)}>
                {connected.has(platform) ? "עדכן חיבור" : "Connect"}
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <button className="btn btn-secondary" onClick={() => setTab("calendar")}>Content calendar</button>
        <button className="btn btn-secondary" onClick={() => setTab("pending")} style={{ marginRight: "0.5rem" }}>Pending approval</button>
        <button className="btn btn-secondary" onClick={() => setTab("analytics")} style={{ marginRight: "0.5rem" }}>Analytics</button>
      </div>

      {tab === "analytics" && (
        <div className="card">
          <h2>Analytics</h2>
          <table><thead><tr><th>פלטפורמה</th><th>לייקים</th><th>תגובות</th><th>Reach</th></tr></thead><tbody>
            {posts.map((post) => <tr key={post.id}><td>{post.platform}</td><td>{post.analytics?.likes ?? 0}</td><td>{post.analytics?.comments ?? 0}</td><td>{post.analytics?.reach ?? 0}</td></tr>)}
          </tbody></table>
        </div>
      )}

      {tab !== "analytics" && (
        <div className="grid">
          {shownPosts.map((post) => (
            <PostCard key={post.id} post={post} onAction={postAction} />
          ))}
        </div>
      )}
    </div>
  );
}

function PostCard({ post, onAction }: { post: SocialPost; onAction: (postId: string, action: "approve" | "reject" | "publish") => Promise<void> }) {
  return (
    <div className="card">
      <strong>{platformIcon(post.platform)} {post.platform}</strong>
      <span className="badge badge-ok" style={{ marginRight: "0.5rem" }}>{post.status}</span>
      <p>{new Date(post.scheduledAt).toLocaleString("he-IL")}</p>
      {post.imageUrl && <img src={post.imageUrl} alt="" style={{ width: "100%", borderRadius: 12 }} />}
      <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit" }}>{post.content}</pre>
      {post.status === "pending_approval" && (
        <>
          <button className="btn" onClick={() => onAction(post.id, "approve")}>Approve</button>
          <button className="btn btn-secondary" onClick={() => onAction(post.id, "reject")} style={{ marginRight: "0.5rem" }}>Reject</button>
        </>
      )}
      {post.status === "approved" && <button className="btn" onClick={() => onAction(post.id, "publish")}>Publish now</button>}
    </div>
  );
}

function platformIcon(platform: string) {
  if (platform === "instagram") return "📸";
  if (platform === "facebook") return "📘";
  return "💼";
}
