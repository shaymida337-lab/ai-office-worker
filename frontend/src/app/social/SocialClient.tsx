"use client";

import { useEffect, useState } from "react";
import { Nav } from "@/components/Nav";
import { apiFetch } from "@/lib/api";
import { BarChart3, BriefcaseBusiness, CalendarDays, Check, Megaphone, Send, Sparkles, Users, X } from "lucide-react";

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

export default function SocialClient() {
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
      <Nav />
      <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="page-kicker">Social command center</div>
          <h1>מנהל סושיאל AI</h1>
          <p>תכנון, אישור ופרסום תוכן לכל לקוח ולכל פלטפורמה.</p>
        </div>
        <button className="btn" onClick={generate} disabled={loading || !clientId}><Sparkles className="h-4 w-4" />{loading ? "יוצר תוכן..." : "Generate content"}</button>
      </div>
      {message && <div className="mb-6 rounded-2xl border border-accent-primary/30 bg-accent-primary/10 p-4 text-sm text-ink-primary">{message}</div>}
      <div className="card">
        <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
          <label>
            לקוח
            <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
            {clients.map((client) => <option value={client.id} key={client.id}>{client.name}</option>)}
            </select>
          </label>
          <div className="badge badge-ok">Approval workflow active</div>
        </div>
      </div>

      <div className="card">
        <h2>חשבונות מחוברים</h2>
        <div className="mt-5 grid gap-5 md:grid-cols-3">
          {platforms.map((platform) => (
            <div className="card" key={platform}>
              <div className="mb-4 flex items-center justify-between">
                <span className="grid h-12 w-12 place-items-center rounded-2xl bg-surface-hover text-accent-primary">{platformIcon(platform)}</span>
                <span className={`badge ${connected.has(platform) ? "badge-ok" : "badge-warn"}`}>{connected.has(platform) ? "מחובר" : "לא מחובר"}</span>
              </div>
              <h3 className="text-lg font-semibold capitalize text-ink-primary">{platform}</h3>
              <p className="mb-4 text-sm">סטטוס חיבור ופרטי פרסום</p>
              <button className="btn btn-secondary" onClick={() => connect(platform)}>
                {connected.has(platform) ? "עדכן חיבור" : "Connect"}
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="flex flex-wrap gap-2">
          <TabButton active={tab === "calendar"} onClick={() => setTab("calendar")} icon={<CalendarDays className="h-4 w-4" />}>Content calendar</TabButton>
          <TabButton active={tab === "pending"} onClick={() => setTab("pending")} icon={<Check className="h-4 w-4" />}>Pending approval</TabButton>
          <TabButton active={tab === "analytics"} onClick={() => setTab("analytics")} icon={<BarChart3 className="h-4 w-4" />}>Analytics</TabButton>
        </div>
      </div>

      {tab === "analytics" && (
        <div className="table-shell">
          <h2>Analytics</h2>
          <table><thead><tr><th>פלטפורמה</th><th>לייקים</th><th>תגובות</th><th>Reach</th></tr></thead><tbody>
            {posts.map((post) => <tr key={post.id}><td>{post.platform}</td><td>{post.analytics?.likes ?? 0}</td><td>{post.analytics?.comments ?? 0}</td><td>{post.analytics?.reach ?? 0}</td></tr>)}
          </tbody></table>
        </div>
      )}

      {tab !== "analytics" && (
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
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
    <div className="card overflow-hidden">
      <div className="mb-4 flex items-center justify-between gap-3">
        <strong className="flex items-center gap-2 capitalize text-ink-primary">{platformIcon(post.platform)} {post.platform}</strong>
        <span className="badge badge-ok">{post.status}</span>
      </div>
      <p className="mb-4 text-sm">{new Date(post.scheduledAt).toLocaleString("he-IL")}</p>
      {post.imageUrl && <img src={post.imageUrl} alt="" className="mb-4 aspect-video w-full rounded-2xl object-cover" />}
      <pre className="mb-5 whitespace-pre-wrap font-sans text-sm leading-7 text-ink-secondary">{post.content}</pre>
      <div className="flex flex-wrap gap-2">
      {post.status === "pending_approval" && (
        <>
          <button className="btn" onClick={() => onAction(post.id, "approve")}><Check className="h-4 w-4" />Approve</button>
          <button className="btn btn-secondary" onClick={() => onAction(post.id, "reject")}><X className="h-4 w-4" />Reject</button>
        </>
      )}
      {post.status === "approved" && <button className="btn" onClick={() => onAction(post.id, "publish")}><Send className="h-4 w-4" />Publish now</button>}
      </div>
    </div>
  );
}

function platformIcon(platform: string) {
  if (platform === "instagram") return <Megaphone className="h-5 w-5" />;
  if (platform === "facebook") return <Users className="h-5 w-5" />;
  return <BriefcaseBusiness className="h-5 w-5" />;
}

function TabButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button className={`btn btn-secondary ${active ? "border-accent-primary bg-accent-primary/10 text-ink-primary" : ""}`} onClick={onClick}>
      {icon}
      {children}
    </button>
  );
}
