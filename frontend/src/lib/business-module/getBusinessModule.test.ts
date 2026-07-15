import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getBusinessModule,
  isModuleNavItemVisible,
  moduleHasNatalieCapability,
} from "./index";

describe("getBusinessModule", () => {
  it("returns base module without insurance tab for service_business", () => {
    const module = getBusinessModule("service_business");
    assert.equal(module.businessType, "service_business");
    assert.equal(module.features.insuranceProfile, false);
    assert.equal(module.clientCard.defaultTab, "details");
    assert.equal(
      module.clientCard.tabs.some((tab) => tab.id === "insurance"),
      false
    );
    assert.equal(module.natalie.clientContext, "generic");
    assert.equal(moduleHasNatalieCapability(module, "read_insurance_profile"), false);
  });

  it("resolves insurance_agency with insurance tab, fields, nav, and Natalie caps", () => {
    const module = getBusinessModule("insurance_agency");
    assert.equal(module.businessType, "insurance_agency");
    assert.equal(module.features.insuranceProfile, true);
    assert.equal(module.clientCard.defaultTab, "insurance");
    assert.ok(module.clientCard.tabs.some((tab) => tab.id === "insurance"));
    assert.ok(module.clientCard.insuranceFields.length > 0);
    assert.equal(module.navigation.itemOverrides.clients, true);
    assert.equal(module.navigation.itemOverrides.crm, true);
    assert.equal(module.crm.layout, "clients_first");
    assert.equal(module.natalie.clientContext, "insured_person");
    assert.ok(moduleHasNatalieCapability(module, "read_insurance_profile"));
    assert.ok(moduleHasNatalieCapability(module, "update_insurance_profile"));
  });

  it("normalizes legacy insurance_agent alias without screen-level branching", () => {
    const module = getBusinessModule("insurance_agent");
    assert.equal(module.businessType, "insurance_agency");
    assert.equal(module.features.insuranceProfile, true);
  });

  it("applies module nav overrides over global defaults", () => {
    const insurance = getBusinessModule("insurance_agency");
    const service = getBusinessModule("service_business");
    assert.equal(isModuleNavItemVisible(insurance, "clients", false), true);
    assert.equal(isModuleNavItemVisible(service, "clients", false), false);
    assert.equal(isModuleNavItemVisible(service, "dashboard", true), true);
  });

  it("keeps CRM fields from business profile for insurance labels", () => {
    const module = getBusinessModule("insurance_agency");
    const nameField = module.crm.fields.find((field) => field.key === "name");
    assert.ok(nameField);
    assert.match(nameField.label, /מבוטח|ליד/);
  });
});
