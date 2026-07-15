import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getBusinessModule } from "@/lib/business-module";
import {
  buildInsuranceHomeOverlay,
  resolveInsuranceHomeMetrics,
} from "./buildInsuranceHomeOverlay.ts";

describe("insurance home overlay", () => {
  it("resolves insurance_agency module with insurance home layout and cards", () => {
    const module = getBusinessModule("insurance_agency");
    assert.equal(module.dashboard.home.layout, "insurance_agency");
    assert.ok(module.dashboard.home.cards.some((card) => card.id === "active_clients"));
    assert.ok(module.dashboard.home.cards.some((card) => card.id === "renewals_placeholder"));
    const renewals = module.dashboard.home.cards.find((card) => card.id === "renewals_placeholder");
    assert.equal(renewals?.placeholderText, "חידושים יופיעו לאחר הוספת פוליסות");
  });

  it("keeps service_business on default home layout", () => {
    const module = getBusinessModule("service_business");
    assert.equal(module.dashboard.home.layout, "default");
    assert.equal(module.dashboard.home.cards.length, 0);
  });

  it("builds overlay from existing metrics only", () => {
    const module = getBusinessModule("insurance_agency");
    const metrics = resolveInsuranceHomeMetrics({
      stats: {
        moneyToPay: 0,
        moneyToReceive: 0,
        pendingInvoices: 99,
        missingInvoicesCount: 0,
        upcomingPaymentsCount: 0,
        openTasks: 4,
        unreadAlerts: 0,
        businessHealthScore: 80,
        overdueCustomerInvoices: 0,
        overdueSupplierPayments: 0,
        hoursSavedThisWeek: 0,
        supplierPaymentsCount: 0,
        totalInvoices: 0,
        unpaidPayments: 0,
        paidPayments: 0,
        scansCompleted: 0,
        driveUploads: 0,
        clients: 12,
        totalClients: 10,
        suspiciousPaymentsCount: 0,
        currency: "ILS",
      },
      pendingDocsCount: 3,
      upcomingAppointments: [
        { id: "1", startTime: new Date().toISOString(), status: "scheduled", client: { name: "א" } },
      ],
      clients: {
        clients: [
          { id: "a", name: "חדש", color: null, createdAt: new Date().toISOString() },
          {
            id: "b",
            name: "ישן",
            color: null,
            createdAt: new Date(2020, 0, 1).toISOString(),
          },
        ],
        totals: { toPay: 0, openTasks: 0, invoices: 0, missingInvoices: 0 },
      },
    });

    assert.equal(metrics.active_clients, 10);
    assert.equal(metrics.open_tasks, 4);
    assert.equal(metrics.pending_docs, 3);
    assert.equal(metrics.new_clients_month, 1);
    assert.ok(metrics.meetings_today >= 1);

    const overlay = buildInsuranceHomeOverlay({
      module,
      metrics,
      loading: false,
      partOfDayGreeting: "בוקר טוב",
    });
    assert.match(overlay.greetingLine, /בוקר טוב\.\s*הנה מצב סוכנות הביטוח/);
    assert.equal(overlay.cards.length, 6);
    const pending = overlay.cards.find((card) => card.id === "pending_docs");
    assert.equal(pending?.displayValue, "3");
    assert.equal(pending?.href, "/dashboard/document-reviews");
    const renewals = overlay.cards.find((card) => card.id === "renewals_placeholder");
    assert.equal(renewals?.clickable, false);
    assert.match(renewals?.displayValue ?? "", /חידושים יופיעו/);
  });
});
