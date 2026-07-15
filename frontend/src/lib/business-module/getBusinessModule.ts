import { normalizeBusinessTypeId, type BusinessTypeId } from "@/lib/business-config";
import { buildBaseBusinessModule } from "./base";
import { BUSINESS_MODULE_OVERLAYS } from "./profiles";
import type { BusinessModuleConfig } from "./types";

function mergeModule(
  base: BusinessModuleConfig,
  overlay: (typeof BUSINESS_MODULE_OVERLAYS)[BusinessTypeId] | undefined
): BusinessModuleConfig {
  if (!overlay) return base;
  const patch = overlay.patch;
  return {
    ...base,
    clientCard: {
      ...base.clientCard,
      ...patch.clientCard,
    },
    crm: {
      ...base.crm,
      ...patch.crm,
    },
    navigation: {
      itemOverrides: {
        ...base.navigation.itemOverrides,
        ...patch.navigation?.itemOverrides,
      },
    },
    dashboard: {
      ...base.dashboard,
      ...patch.dashboard,
      home: {
        ...base.dashboard.home,
        ...patch.dashboard?.home,
        cards: patch.dashboard?.home?.cards ?? base.dashboard.home.cards,
        summaryMetricIds:
          patch.dashboard?.home?.summaryMetricIds ?? base.dashboard.home.summaryMetricIds,
      },
    },
    natalie: {
      ...base.natalie,
      ...patch.natalie,
      capabilities: patch.natalie?.capabilities ?? base.natalie.capabilities,
    },
    features: {
      ...base.features,
      ...patch.features,
    },
  };
}

/**
 * Resolve the business module for an organization business type.
 * This is the only API screens should use for vertical adaptation.
 */
export function getBusinessModule(businessType: unknown): BusinessModuleConfig {
  const id = normalizeBusinessTypeId(businessType);
  return mergeModule(buildBaseBusinessModule(id), BUSINESS_MODULE_OVERLAYS[id]);
}

/** Whether a specific nav item is visible for this resolved module (and global defaults). */
export function isModuleNavItemVisible(
  module: BusinessModuleConfig,
  itemId: keyof BusinessModuleConfig["navigation"]["itemOverrides"],
  globalVisible: boolean
): boolean {
  const override = module.navigation.itemOverrides[itemId];
  if (typeof override === "boolean") return override;
  return globalVisible;
}

export function moduleHasNatalieCapability(
  module: BusinessModuleConfig,
  capability: BusinessModuleConfig["natalie"]["capabilities"][number]
): boolean {
  return module.natalie.capabilities.includes(capability);
}
