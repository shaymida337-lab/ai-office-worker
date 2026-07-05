"use client";

import { useEffect, useState } from "react";
import { Nav } from "@/components/Nav";
import { apiFetch } from "@/lib/api";
import { BarChart3, BriefcaseBusiness, CalendarDays, Check, Megaphone, Send, Sparkles, Users, X } from "lucide-react";

type ClientItem = { id: string; name: string; email: string | null };
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
  const [connectPlatform, setConnectPlatform] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [pageId, setPageId] = useState("");

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

  async function connect(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const platform = connectPlatform;
    if (!clientId) return;
    setLoading(true);
    setMessage("");
    try {
      const result = await apiFetch<{ oauthUrl?: string; connected?: boolean }>(`/api/social/connect/${platform}`, {
        method: "POST",
        body: JSON.stringify({ clientId, accessToken, pageId }),
      });
      if (result.oauthUrl && !accessToken) window.location.href = result.oauthUrl;
      setMessage(result.connected ? `${platformLabel(platform)} חובר בהצלחה` : `נפתח חיבור מאובטח עבור ${platformLabel(platform)}`);
      setConnectPlatform("");
      setAccessToken("");
      setPageId("");
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "חיבור חשבון סושיאל נכשל");
    } finally {
      setLoading(false);
    }
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
    setLoading(true);
    setMessage("");
    try {
      await apiFetch(`/api/social/${action}/${postId}`, { method: "POST" });
      setMessage(action === "approve" ? "הפוסט אושר" : action === "reject" ? "הפוסט נדחה" : "הפוסט פורסם");
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "פעולת הסושיאל נכשלה");
    } finally {
      setLoading(false);
    }
  }

  const shownPosts = tab === "pending" ? posts.filter((post) => post.status === "pending_approval") : posts;
  const connected = new Set(accounts.filter((account) => account.isActive).map((account) => account.platform));

  return (
    <div className="container">
      <Nav />
      <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="page-kicker">מרכז ניהול סושיאל</div>
          <h1>מנהל סושיאל חכם</h1>
          <p>תכנון, אישור ופרסום תוכן לכל לקוח ולכל פלטפורמה.</p>
        </div>
        <button className="btn" onClick={generate} disabled={loading || !clientId}><Sparkles className="h-4 w-4" />{loading ? "יוצר תוכן..." : "צור תוכן"}</button>
      </div>
      {message && <div className="mb-6 rounded-2xl border border-accent-primary/30 bg-accent-primary/10 p-4 text-sm text-ink-primary">{message}</div>}
      {clients.length === 0 && (
        <div className="card">
          <h2>אין לקוחות לסושיאל</h2>
          <p className="mt-2">הוסף לקוח ראשון כדי לחבר חשבונות, ליצור תוכן ולהפעיל תהליך אישור.</p>
        </div>
      )}
      <div className="card">
        <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
          <label>
            לקוח
            <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
            {clients.map((client) => <option value={client.id} key={client.id}>{client.name}</option>)}
            </select>
          </label>
          <div className="badge badge-ok">תהליך אישור פעיל</div>
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
              <h3 className="text-lg font-semibold text-ink-primary">{platformLabel(platform)}</h3>
              <p className="mb-4 text-sm">סטטוס חיבור ופרטי פרסום</p>
              <button className="btn btn-secondary" onClick={() => setConnectPlatform(platform)}>
                {connected.has(platform) ? "עדכן חיבור" : "חבר חשבון"}
              </button>
            </div>
          ))}
        </div>
      </div>

      {connectPlatform && (
        <div className="fixed inset-0 z-[110] grid place-items-end bg-black/70 p-4 backdrop-blur-sm sm:place-items-center">
          <form onSubmit={connect} className="card max-h-[85vh] w-full max-w-xl overflow-y-auto">
            <h2>חיבור {platformLabel(connectPlatform)}</h2>
            <p>הדבק פרטי חיבור או השאר את השדה ריק כדי לפתוח חיבור מאובטח אם השרת תומך בכך.</p>
            <label>
              טוקן גישה
              <input dir="ltr" value={accessToken} onChange={(event) => setAccessToken(event.target.value)} placeholder="טוקן גישה" />
            </label>
            <label>
              מזהה עמוד / עסק
              <input dir="ltr" value={pageId} onChange={(event) => setPageId(event.target.value)} placeholder="מזהה עמוד או יוצר" />
            </label>
            <div className="mt-4 grid gap-2 sm:flex sm:flex-wrap">
              <button className="btn" type="submit" disabled={loading}>{loading ? "מחבר..." : "חבר חשבון"}</button>
              <button className="btn btn-secondary" type="button" onClick={() => setConnectPlatform("")}>ביטול</button>
            </div>
          </form>
        </div>
      )}

      <div className="card">
        <div className="flex flex-wrap gap-2">
          <TabButton active={tab === "calendar"} onClick={() => setTab("calendar")} icon={<CalendarDays className="h-4 w-4" />}>יומן תוכן</TabButton>
          <TabButton active={tab === "pending"} onClick={() => setTab("pending")} icon={<Check className="h-4 w-4" />}>ממתין לאישור</TabButton>
          <TabButton active={tab === "analytics"} onClick={() => setTab("analytics")} icon={<BarChart3 className="h-4 w-4" />}>ביצועים</TabButton>
        </div>
      </div>

      {tab === "analytics" && (
        posts.length === 0 ? (
          <div className="card">
            <h2>אין נתוני ביצועים עדיין</h2>
            <p className="mt-2">לאחר פרסום פוסטים יוצגו כאן נתוני חשיפה, לייקים ותגובות.</p>
          </div>
        ) : (
          <>
            <div className="grid gap-4 md:hidden">
              {posts.map((post) => (
                <div className="card" key={post.id}>
                  <h2>{platformLabel(post.platform)}</h2>
                  <div className="mt-3 grid gap-2 rounded-2xl bg-surface-secondary p-3">
                    <MetricRow label="לייקים" value={post.analytics?.likes ?? 0} />
                    <MetricRow label="תגובות" value={post.analytics?.comments ?? 0} />
                    <MetricRow label="חשיפה" value={post.analytics?.reach ?? 0} />
                  </div>
                </div>
              ))}
            </div>
            <div className="table-shell hidden md:block">
              <h2 className="p-4">נתוני ביצועים</h2>
              <table><thead><tr><th>פלטפורמה</th><th>לייקים</th><th>תגובות</th><th>חשיפה</th></tr></thead><tbody>
                {posts.map((post) => <tr key={post.id}><td>{platformLabel(post.platform)}</td><td>{post.analytics?.likes ?? 0}</td><td>{post.analytics?.comments ?? 0}</td><td>{post.analytics?.reach ?? 0}</td></tr>)}
              </tbody></table>
            </div>
          </>
        )
      )}

      {tab !== "analytics" && (
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {shownPosts.map((post) => (
            <PostCard key={post.id} post={post} onAction={postAction} />
          ))}
          {shownPosts.length === 0 && (
            <div className="card">
              <h2>{tab === "pending" ? "אין פוסטים שממתינים לאישור" : "אין פוסטים ביומן"}</h2>
              <p className="mt-2">{tab === "pending" ? "פוסטים חדשים לאישור יופיעו כאן אחרי יצירת תוכן." : "צור תוכן כדי לבנות יומן פרסום שבועי."}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PostCard({ post, onAction }: { post: SocialPost; onAction: (postId: string, action: "approve" | "reject" | "publish") => Promise<void> }) {
  return (
    <div className="card overflow-hidden">
      <div className="mb-4 flex items-center justify-between gap-3">
        <strong className="flex items-center gap-2 text-ink-primary">{platformIcon(post.platform)} {platformLabel(post.platform)}</strong>
        <span className="badge badge-ok">{postStatusLabel(post.status)}</span>
      </div>
      <p className="mb-4 text-sm">{new Date(post.scheduledAt).toLocaleString("he-IL")}</p>
      {post.imageUrl && <img src={post.imageUrl} alt="" className="mb-4 aspect-video w-full rounded-2xl object-cover" />}
      <pre className="mb-5 whitespace-pre-wrap font-sans text-sm leading-7 text-ink-secondary">{post.content}</pre>
      <div className="flex flex-wrap gap-2">
      {post.status === "pending_approval" && (
        <>
          <button className="btn" onClick={() => onAction(post.id, "approve")}><Check className="h-4 w-4" />אשר</button>
          <button className="btn btn-secondary" onClick={() => onAction(post.id, "reject")}><X className="h-4 w-4" />דחה</button>
        </>
      )}
      {post.status === "approved" && <button className="btn" onClick={() => onAction(post.id, "publish")}><Send className="h-4 w-4" />פרסם עכשיו</button>}
      </div>
    </div>
  );
}

function platformIcon(platform: string) {
  if (platform === "instagram") return <Megaphone className="h-5 w-5" />;
  if (platform === "facebook") return <Users className="h-5 w-5" />;
  return <BriefcaseBusiness className="h-5 w-5" />;
}

function platformLabel(platform: string) {
  const labels: Record<string, string> = {
    instagram: "אינסטגרם",
    facebook: "פייסבוק",
    linkedin: "לינקדאין",
  };
  return labels[platform] ?? "סושיאל";
}

function postStatusLabel(status: string) {
  const labels: Record<string, string> = {
    pending_approval: "ממתין לאישור",
    approved: "אושר",
    rejected: "נדחה",
    published: "פורסם",
  };
  return labels[status] ?? status;
}

function TabButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button className={`btn btn-secondary ${active ? "border-accent-primary bg-accent-primary/10 text-ink-primary" : ""}`} onClick={onClick}>
      {icon}
      {children}
    </button>
  );
}

function MetricRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-ink-secondary">{label}</span>
      <strong className="text-ink-primary">{value.toLocaleString("he-IL")}</strong>
    </div>
  );
}
