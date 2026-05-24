"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Nav } from "@/components/Nav";
import { apiFetch } from "@/lib/api";

type WhatsAppStatus = {
  configured: boolean;
  connected: boolean;
  ownerWhatsApp: string;
  from: string;
  webhookUrl: string;
  connectedAt: string | null;
};

type ClientItem = {
  id: string;
  name: string;
  email: string;
  whatsappNumber: string | null;
  whatsappUnread?: number;
  whatsappLastMessage?: { body: string; createdAt: string } | null;
};

export default function WhatsAppSettingsPage() {
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [clients, setClients] = useState<ClientItem[]>([]);
  const [ownerWhatsApp, setOwnerWhatsApp] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function load() {
    const next = await apiFetch<WhatsAppStatus>("/api/whatsapp/status");
    const clientData = await apiFetch<{ clients: ClientItem[] }>("/api/clients");
    setStatus(next);
    setClients(clientData.clients);
    setOwnerWhatsApp(next.ownerWhatsApp.replace(/^whatsapp:/, ""));
  }

  useEffect(() => {
    load().catch((err) => setMessage(err instanceof Error ? err.message : "Failed to load WhatsApp settings"));
  }, []);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setLoading(true);
    try {
      await apiFetch<WhatsAppStatus>("/api/settings/whatsapp", {
        method: "POST",
        body: JSON.stringify({ ownerWhatsApp }),
      });
      await load();
      setMessage("מספר נשמר בהצלחה");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to save WhatsApp settings");
    } finally {
      setLoading(false);
    }
  }

  async function sendTest() {
    setMessage("");
    setLoading(true);
    try {
      await apiFetch("/api/whatsapp/test", { method: "POST" });
      setMessage("הודעת בדיקה נשלחה!");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to send test message");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container">
      <h1>WhatsApp</h1>
      <Nav />
      {message && <p>{message}</p>}
      <div className="card">
        <p>Twilio: {status?.configured ? "✅ Configured" : "❌ Not configured"}</p>
        <p>Connection: {status?.connected ? "✅ Connected" : "❌ Not connected"}</p>
        <p>From: {status?.from || "Not set"}</p>
        <p>Webhook: {status?.webhookUrl || "Not set"}</p>
        {status && !status.configured && (
          <div style={{ background: "#fef3c7", color: "#92400e", padding: "1rem", borderRadius: 8 }}>
            <strong>⚠️ כדי להפעיל WhatsApp:</strong>
            <ol>
              <li>כנס ל: console.twilio.com</li>
              <li>העתק את Account SID ו-Auth Token</li>
              <li>הוסף ל-Render</li>
            </ol>
          </div>
        )}
        <form onSubmit={save} style={{ display: "grid", gap: "0.75rem" }}>
          <label>
            Owner WhatsApp number
            <input
              dir="ltr"
              placeholder="+972501234567"
              value={ownerWhatsApp}
              onChange={(e) => setOwnerWhatsApp(e.target.value)}
            />
          </label>
          <button className="btn" type="submit" disabled={loading}>
            {loading ? "Saving..." : "Save WhatsApp Number"}
          </button>
        </form>
        <button className="btn btn-secondary" onClick={sendTest} disabled={loading || !status?.configured}>
          Send Test Message
        </button>
      </div>
      <div className="card">
        <h2>Client WhatsApp Activity</h2>
        {clients.length === 0 ? (
          <p>No clients yet</p>
        ) : (
          clients.map((client) => (
            <div key={client.id} style={{ borderTop: "1px solid var(--border)", padding: "0.75rem 0" }}>
              <Link href={`/dashboard/clients/${client.id}`}>
                <strong>{client.name}</strong>
              </Link>
              <p>{client.whatsappNumber || "No WhatsApp number configured"}</p>
              {Boolean(client.whatsappUnread) && <strong>{client.whatsappUnread} unread</strong>}
              {client.whatsappLastMessage && <p>{client.whatsappLastMessage.body}</p>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
