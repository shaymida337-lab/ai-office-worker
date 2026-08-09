/**
 * Simulate CRM bottom-search vs global top-search for "שרית" against live prod API.
 * Uses the same merge rules as the crm/page.tsx fix.
 */
import { readFileSync } from "fs";
import { join } from "path";

async function main() {
  const q = "שרית";
  const token = readFileSync(join(process.cwd(), ".tmp-shay-token.txt"), "utf8").trim();
  const headers = { Authorization: `Bearer ${token}` };
  const api = "https://ai-office-worker-backend.onrender.com";

  const [clientsRes, leadsRes] = await Promise.all([
    fetch(`${api}/api/clients`, { headers }),
    fetch(`${api}/api/leads?search=${encodeURIComponent(q)}`, { headers }),
  ]);

  const clientsJson = (await clientsRes.json()) as {
    clients: Array<{ id: string; name: string; email?: string | null; whatsappNumber?: string | null }>;
  };
  const leadsJson = (await leadsRes.json()) as {
    leads: Array<{
      id: string;
      name: string;
      company?: string | null;
      phone?: string | null;
      email?: string | null;
      whatsapp?: string | null;
    }>;
  };

  const query = q.trim().toLowerCase();

  const globalHits = (clientsJson.clients ?? [])
    .filter((client) =>
      `${client.name} ${client.email ?? ""} ${client.whatsappNumber ?? ""}`.toLowerCase().includes(query)
    )
    .map((c) => ({ source: "client", id: c.id, name: c.name }));

  const leads = leadsJson.leads ?? [];
  const searchedLeads = leads.filter((lead) =>
    `${lead.name} ${lead.company ?? ""} ${lead.phone ?? ""} ${lead.email ?? ""} ${lead.whatsapp ?? ""}`
      .toLowerCase()
      .includes(query)
  );

  const leadNames = new Set(leads.map((lead) => lead.name.trim().toLowerCase()).filter(Boolean));
  const clientRows = (clientsJson.clients ?? [])
    .filter((client) =>
      `${client.name} ${client.email ?? ""} ${client.whatsappNumber ?? ""}`.toLowerCase().includes(query)
    )
    .filter((client) => !leadNames.has(client.name.trim().toLowerCase()))
    .map((c) => ({ source: "client-row", id: `client:${c.id}`, name: c.name }));

  const bottomHits = [
    ...searchedLeads.map((l) => ({ source: "lead", id: l.id, name: l.name })),
    ...clientRows,
  ];

  const beforeFixWouldMiss = searchedLeads.length === 0 && globalHits.length > 0;
  const afterFixMatches =
    bottomHits.some((h) => h.name.includes(q)) && globalHits.some((h) => h.name.includes(q));

  console.log(
    JSON.stringify(
      {
        beforeFixWouldMiss,
        afterFixMatches,
        globalHits,
        bottomHitsBefore: searchedLeads.map((l) => l.name),
        bottomHitsAfter: bottomHits,
      },
      null,
      2
    )
  );

  if (!afterFixMatches) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
