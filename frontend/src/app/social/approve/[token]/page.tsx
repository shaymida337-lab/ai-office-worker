"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type SocialPost = {
  id: string;
  platform: string;
  content: string;
  imageUrl: string | null;
  scheduledAt: string;
  status: string;
};

export default function SocialApprovalPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingPosts, setLoadingPosts] = useState(true);

  async function load() {
    const response = await fetch(`${API_URL}/api/social/approval/${token}`);
    if (!response.ok) throw new Error("קישור האישור לא תקין");
    const data = await response.json() as { posts: SocialPost[] };
    setPosts(data.posts);
  }

  useEffect(() => {
    load()
      .catch((err) => setMessage(err instanceof Error ? err.message : "טעינת פוסטים נכשלה"))
      .finally(() => setLoadingPosts(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function action(postId: string, kind: "approve" | "reject") {
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/social/${kind}/${postId}`, { method: "POST" });
      if (!response.ok) throw new Error(kind === "approve" ? "האישור נכשל" : "הדחייה נכשלה");
      await load();
      setMessage(kind === "approve" ? "הפוסט אושר" : "הפוסט נשלח ליצירה מחדש");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "הפעולה נכשלה");
    } finally {
      setLoading(false);
    }
  }

  async function approveAll() {
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/social/approve-all/${token}`, { method: "POST" });
      if (!response.ok) throw new Error("אישור כל הפוסטים נכשל");
      await load();
      setMessage("כל הפוסטים אושרו");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "אישור כל הפוסטים נכשל");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container">
      <h1>אישור תוכן סושיאל</h1>
      <p>בדוק את הפוסטים הבאים ואשר או דחה בלחיצה אחת.</p>
      {message && <div className="mb-6 rounded-2xl border border-accent-primary/30 bg-accent-primary/10 p-4 text-base text-ink-primary">{message}</div>}
      <button className="btn" onClick={approveAll} disabled={loading || posts.length === 0}>{loading ? "מעדכן..." : "אשר הכול"}</button>
      {loadingPosts && <div className="card mt-4"><p>טוען פוסטים לאישור...</p></div>}
      {!loadingPosts && posts.length === 0 && <div className="card mt-4"><p>אין פוסטים שממתינים לאישור.</p></div>}
      <div className="mt-4 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {posts.map((post) => (
          <div className="card" key={post.id}>
            <strong>{post.platform}</strong>
            <span className="badge badge-ok mr-2">{post.status}</span>
            <p>{new Date(post.scheduledAt).toLocaleString("he-IL")}</p>
            {post.imageUrl && <img src={post.imageUrl} alt="" className="my-4 aspect-video w-full rounded-2xl object-cover" />}
            <pre className="whitespace-pre-wrap font-sans text-sm leading-7 text-ink-secondary">{post.content}</pre>
            <button className="btn" disabled={loading || post.status === "approved"} onClick={() => action(post.id, "approve")}>אשר</button>
            <button className="btn btn-secondary mt-2 md:mr-2 md:mt-0" disabled={loading} onClick={() => action(post.id, "reject")}>דחה</button>
          </div>
        ))}
      </div>
    </div>
  );
}
