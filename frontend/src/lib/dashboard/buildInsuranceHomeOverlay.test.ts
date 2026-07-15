import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getBusinessModule } from "@/lib/business-module";
import {
  buildInsuranceHomeOverlay,
  resolveInsuranceHomeMetrics,
} from "./buildInsuranceHomeOverlay.ts";
import { DASHBOARD_NO_DATA_LABEL } from "./homeMetrics.ts";

const loadedMetrics = {
  active_clients: 10,
  open_tasks: 4,
  meetings_today: 2,
  pending_docs: 3,
  new_clients_month: 1,
};

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

  it("uses authoritative home metrics without client list fallbacks", () => {
    const module = getBusinessModule("insurance_agency");
    const metrics = resolveInsuranceHomeMetrics({
      homeMetrics: loadedMetrics,
      metricsLoaded: true,
    });
    assert.deepEqual(metrics, loadedMetrics);

    const overlay = buildInsuranceHomeOverlay({
      module,
      metrics,
      metricsLoaded: true,
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

  it("shows no-data label when metrics failed to load", () => {
    const module = getBusinessModule("insurance_agency");
    const metrics = resolveInsuranceHomeMetrics({
      homeMetrics: null,
      metricsLoaded: false,
    });
    assert.equal(metrics.active_clients, null);
    const overlay = buildInsuranceHomeOverlay({
      module,
      metrics,
      metricsLoaded: false,
      partOfDayGreeting: "בוקר טוב",
    });
    const active = overlay.cards.find((card) => card.id === "active_clients");
    assert.equal(active?.displayValue, "—");
  });

  it("shows no-data when loaded but payload missing", () => {
    const module = getBusinessModule("insurance_agency");
    const metrics = resolveInsuranceHomeMetrics({
      homeMetrics: null,
      metricsLoaded: true,
    });
    const overlay = buildInsuranceHomeOverlay({
      module,
      metrics,
      metricsLoaded: true,
      partOfDayGreeting: "בוקר טוב",
    });
    const active = overlay.cards.find((card) => card.id === "active_clients");
    assert.equal(active?.displayValue, DASHBOARD_NO_DATA_LABEL);
  });
});
