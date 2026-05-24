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
    const next = await apiFetch<WhatsAppStatus>("/api/integrations/whatsapp/status");
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
      const next = await apiFetch<WhatsAppStatus>("/api/integrations/whatsapp/settings", {
        method: "PUT",
        body: JSON.stringify({ ownerWhatsApp }),
      });
      setStatus(next);
      setMessage("WhatsApp settings saved");
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
      await apiFetch("/api/integrations/whatsapp/test", { method: "POST" });
      setMessage("Test WhatsApp message sent");
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
        <p>Twilio: {status?.configured ? "Configured" : "Not configured"}</p>
        <p>Connection: {status?.connected ? "Connected" : "Not connected"}</p>
        <p>From: {status?.from || "Not set"}</p>
        <p>Webhook: https://ai-office-worker-backend.onrender.com/webhook/whatsapp</p>
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
            Save WhatsApp Number
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
