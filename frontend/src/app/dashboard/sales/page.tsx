"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Nav } from "@/components/Nav";
import { apiFetch } from "@/lib/api";
import {
  computeSalesKpis,
  DEAL_STAGE_LABELS,
  DEAL_STAGE_TONE,
  DEAL_STAGES,
  dealSubtitle,
  formatIls,
  isDealStage,
  latestQuote,
  quoteBadge,
  QUOTE_STATUS_LABELS,
  type DealStage,
  type SalesDeal,
} from "@/lib/salesUtils";
import { GripVertical, List, Plus, TrendingUp, X } from "lucide-react";

type ViewMode = "kanban" | "list";

export default function SalesPage() {
  const [deals, setDeals] = useState<SalesDeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [view, setView] = useState<ViewMode>("kanban");
  const [selected, setSelected] = useState<SalesDeal | null>(null);
  const [draggedId, setDraggedId] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  const load = useCallback(async () => {
    const result = await apiFetch<{ deals: SalesDeal[] }>("/api/deals");
    setDeals(result.deals);
  }, []);

  useEffect(() => {
    load()
      .catch((err) => setMessage(err instanceof Error ? err.message : "טעינת מכירות נכשלה"))
      .finally(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const kpis = useMemo(() => computeSalesKpis(deals), [deals]);
  const effectiveView = isMobile ? "list" : view;

  async function updateDealStage(dealId: string, stage: DealStage) {
    setMessage("");
    try {
      const result = await apiFetch<{ deal: SalesDeal }>(`/api/deals/${dealId}`, {
        method: "PATCH",
        body: JSON.stringify({ stage }),
      });
      setSelected((current) => (current?.id === dealId ? result.deal : current));
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "עדכון שלב נכשל");
    }
  }

  async function dropDeal(stage: DealStage) {
    if (!draggedId) return;
    const id = draggedId;
    setDraggedId("");
    await updateDealStage(id, stage);
  }

  async function createDeal(event: React.FormEvent) {
    event.preventDefault();
    if (!newTitle.trim()) return;
    setSaving(true);
    setMessage("");
    try {
      await apiFetch("/api/deals", {
        method: "POST",
        body: JSON.stringify({ title: newTitle.trim() }),
      });
      setNewTitle("");
      setShowCreate(false);
      setMessage("העסקה נוצרה");
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "יצירת עסקה נכשלה");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="container">
      <Nav />
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="page-kicker">מכירות</div>
          <h1>הצעות מחיר ומשפך עסקאות</h1>
        </div>
        <button type="button" className="btn !w-auto" onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4" />
          עסקה חדשה
        </button>
      </div>

      {message && <p className="mb-4 text-sm text-ink-secondary">{message}</p>}

      <section className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="ערך פתוח" value={formatIls(kpis.openValue)} />
        <KpiCard label="הצעות ממתינות" value={String(kpis.pendingQuotes)} />
        <KpiCard label="אחוז סגירה" value={`${kpis.winRate}%`} />
        <KpiCard label="סה״כ עסקאות" value={String(kpis.total)} />
      </section>

      {!isMobile && (
        <section className="card mb-6">
          <div className="flex flex-wrap gap-2">
            <ViewButton active={view === "kanban"} onClick={() => setView("kanban")} icon={<GripVertical className="h-4 w-4" />}>
              לוח שלבים
            </ViewButton>
            <ViewButton active={view === "list"} onClick={() => setView("list")} icon={<List className="h-4 w-4" />}>
              רשימה
            </ViewButton>
          </div>
        </section>
      )}

      {showCreate && (
        <form onSubmit={createDeal} className="card mb-6 grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
          <label>
            שם העסקה / לקוח
            <input required value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="למשל: דנה כהן — ייעוץ" />
          </label>
          <div className="flex gap-2">
            <button type="button" className="btn btn-secondary" onClick={() => setShowCreate(false)}>
              ביטול
            </button>
            <button type="submit" className="btn" disabled={saving}>
              {saving ? "שומר..." : "צור עסקה"}
            </button>
          </div>
        </form>
      )}

      {loading && <div className="card"><p>טוען מכירות...</p></div>}

      {!loading && deals.length === 0 && (
        <div className="card text-center">
          <TrendingUp className="mx-auto mb-4 h-10 w-10 text-ink-muted" />
          <h2>אין עסקאות פתוחות עדיין</h2>
          <p className="mt-2 text-sm text-ink-secondary">צור עסקה מליד ב-CRM או מ-Natalie, או הוסף עסקה ידנית.</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Link href="/crm" className="btn btn-secondary !w-auto">עבור ל-CRM</Link>
            <button type="button" className="btn !w-auto" onClick={() => setShowCreate(true)}>עסקה חדשה</button>
          </div>
        </div>
      )}

      {!loading && deals.length > 0 && effectiveView === "kanban" && (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {DEAL_STAGES.map((stage) => {
            const columnDeals = deals.filter((deal) => deal.stage === stage);
            const columnValue = columnDeals.reduce((sum, deal) => sum + deal.estimatedValue, 0);
            return (
              <div
                key={stage}
                className={`rounded-2xl border p-3 ${DEAL_STAGE_TONE[stage]}`}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => void dropDeal(stage)}
              >
                <div className="mb-3 flex items-center justify-between gap-2">
                  <strong>{DEAL_STAGE_LABELS[stage]}</strong>
                  <span className="badge badge-ok">{columnDeals.length}</span>
                </div>
                <p className="mb-3 text-sm opacity-80">{formatIls(columnValue)}</p>
                <div className="grid gap-3">
                  {columnDeals.map((deal) => (
                    <DealCard
                      key={deal.id}
                      deal={deal}
                      onOpen={() => setSelected(deal)}
                      onDrag={() => setDraggedId(deal.id)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </section>
      )}

      {!loading && deals.length > 0 && effectiveView === "list" && (
        <section className="table-shell">
          <table>
            <thead>
              <tr>
                <th>לקוח</th>
                <th>ערך</th>
                <th>הצעה</th>
                <th>שלב</th>
                <th>עודכן</th>
              </tr>
            </thead>
            <tbody>
              {deals.map((deal) => (
                <tr key={deal.id} className="cursor-pointer" onClick={() => setSelected(deal)}>
                  <td>
                    {deal.title}
                    <br />
                    <span className="text-ink-muted">{dealSubtitle(deal)}</span>
                  </td>
                  <td>{formatIls(deal.estimatedValue)}</td>
                  <td>{quoteBadge(deal) ?? "—"}</td>
                  <td>{isDealStage(deal.stage) ? DEAL_STAGE_LABELS[deal.stage] : deal.stage}</td>
                  <td>{new Date(deal.updatedAt).toLocaleDateString("he-IL")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {selected && (
        <DealDrawer
          deal={selected}
          onClose={() => setSelected(null)}
          onStageChange={(stage) => void updateDealStage(selected.id, stage)}
        />
      )}
    </div>
  );
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-surface-card p-4">
      <div className="text-sm text-ink-secondary">{label}</div>
      <strong className="mt-1 block text-2xl text-ink-primary">{value}</strong>
    </div>
  );
}

function DealCard({ deal, onOpen, onDrag }: { deal: SalesDeal; onOpen: () => void; onDrag: () => void }) {
  const badge = quoteBadge(deal);
  return (
    <button
      type="button"
      draggable
      onDragStart={onDrag}
      onClick={onOpen}
      className="group w-full rounded-2xl border border-[var(--border)] bg-surface-card p-4 text-right transition hover:-translate-y-0.5"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <strong className="block truncate text-ink-primary">{deal.title}</strong>
          <span className="block truncate text-sm text-ink-secondary">{dealSubtitle(deal)}</span>
        </div>
        <GripVertical className="h-4 w-4 shrink-0 text-ink-muted" />
      </div>
      <div className="grid gap-1 text-sm text-ink-secondary">
        <span>{formatIls(deal.estimatedValue)}</span>
        {deal.lead && <span className="badge badge-warn">מליד</span>}
        {badge && <span>{badge}</span>}
      </div>
    </button>
  );
}

function DealDrawer({
  deal,
  onClose,
  onStageChange,
}: {
  deal: SalesDeal;
  onClose: () => void;
  onStageChange: (stage: DealStage) => void;
}) {
  const quote = latestQuote(deal);

  return (
    <div className="fixed inset-0 z-[120] grid place-items-end bg-black/70 p-4 backdrop-blur-sm sm:place-items-center">
      <div className="card max-h-[88vh] w-full max-w-3xl overflow-y-auto">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <div className="page-kicker">תיק מכירה</div>
            <h2>{deal.title}</h2>
            <p className="text-sm text-ink-secondary">
              {dealSubtitle(deal)} · נוצר {new Date(deal.createdAt).toLocaleDateString("he-IL")}
            </p>
          </div>
          <button type="button" className="btn btn-secondary !w-auto" onClick={onClose}>
            <X className="h-4 w-4" />
            סגור
          </button>
        </div>

        <div className="mb-4 grid gap-2 sm:flex sm:flex-wrap">
          {DEAL_STAGES.map((stage) => (
            <button
              key={stage}
              type="button"
              className={deal.stage === stage ? "btn !w-auto" : "btn btn-toggle-inactive !w-auto"}
              onClick={() => onStageChange(stage)}
            >
              {DEAL_STAGE_LABELS[stage]}
            </button>
          ))}
        </div>

        <div className="mb-6 grid gap-3 md:grid-cols-3">
          <Info label="ערך" value={formatIls(deal.estimatedValue)} />
          <Info label="שלב" value={isDealStage(deal.stage) ? DEAL_STAGE_LABELS[deal.stage] : deal.stage} />
          <Info label="אחראי" value={deal.assignedTo || "לא הוגדר"} />
        </div>

        {deal.leadId && (
          <Link href="/crm" className="btn btn-secondary mb-6 inline-flex !w-auto">
            פתח ליד ב-CRM
          </Link>
        )}

        <section>
          <h3 className="mb-3 text-lg font-semibold text-ink-primary">הצעות מחיר</h3>
          {deal.quotes.length === 0 && (
            <p className="text-sm text-ink-secondary">אין הצעות עדיין — בונה הצעות יגיע ב-Sprint הבא.</p>
          )}
          <div className="grid gap-3">
            {deal.quotes.map((item) => (
              <div key={item.id} className="rounded-2xl border border-[var(--border)] bg-surface-secondary p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <strong>
                    v{item.version} · {QUOTE_STATUS_LABELS[item.status] ?? item.status}
                  </strong>
                  <span>{formatIls(item.total)}</span>
                </div>
                {item.validUntil && (
                  <p className="text-sm text-ink-secondary">
                    תוקף עד {new Date(item.validUntil).toLocaleDateString("he-IL")}
                  </p>
                )}
                {item.lines.length > 0 && (
                  <ul className="mt-2 space-y-1 text-sm text-ink-secondary">
                    {item.lines.map((line) => (
                      <li key={line.id}>
                        {line.description} — {line.quantity} × {formatIls(line.unitPrice)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </section>

        {quote && quote.status === "accepted" && (
          <p className="mt-4 text-sm text-emerald-200">ההצעה אושרה — המרה לחשבונית תגיע ב-Sprint הבא.</p>
        )}
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-surface-secondary p-3">
      <div className="text-sm text-ink-muted">{label}</div>
      <strong className="text-ink-primary">{value}</strong>
    </div>
  );
}

function ViewButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button type="button" className={active ? "btn !w-auto" : "btn btn-toggle-inactive !w-auto"} onClick={onClick}>
      {icon}
      {children}
    </button>
  );
}
