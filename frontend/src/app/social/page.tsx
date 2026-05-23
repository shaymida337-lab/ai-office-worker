"use client";

import { useEffect, useState } from "react";
import { Nav } from "@/components/Nav";
import { apiFetch, type SocialDraft } from "@/lib/api";

export default function SocialPage() {
  const [drafts, setDrafts] = useState<SocialDraft[]>([]);
  const [platform, setPlatform] = useState("facebook");
  const [topic, setTopic] = useState("");
  const [tone, setTone] = useState("מקצועי וידידותי");

  async function load() {
    setDrafts(await apiFetch<SocialDraft[]>("/api/social-drafts"));
  }

  useEffect(() => {
    load();
  }, []);

  async function createDraft(e: React.FormEvent) {
    e.preventDefault();
    await apiFetch("/api/social-drafts", {
      method: "POST",
      body: JSON.stringify({ platform, topic, tone }),
    });
    setTopic("");
    await load();
  }

  return (
    <div className="container">
      <h1>טיוטות סושיאל</h1>
      <Nav />
      <div className="card">
        <form onSubmit={createDraft}>
          <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
            <option value="facebook">Facebook</option>
            <option value="instagram">Instagram</option>
          </select>
          <input placeholder="נושא הפוסט" value={topic} onChange={(e) => setTopic(e.target.value)} required style={{ marginRight: "0.5rem" }} />
          <input placeholder="טון כתיבה" value={tone} onChange={(e) => setTone(e.target.value)} style={{ marginRight: "0.5rem" }} />
          <button className="btn" style={{ marginRight: "0.5rem" }}>צור טיוטה</button>
        </form>
      </div>
      {drafts.map((d) => (
        <div className="card" key={d.id}>
          <strong>{d.platform} — {d.topic}</strong>
          <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit" }}>{d.content}</pre>
        </div>
      ))}
    </div>
  );
}
