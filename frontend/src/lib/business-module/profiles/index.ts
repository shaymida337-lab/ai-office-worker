import type { BusinessTypeId } from "@/lib/business-config";
import { insuranceAgencyModule } from "./insuranceAgency";
import type { BusinessModuleOverlay } from "../types";

/**
 * Registry of vertical overlays.
 * Adding a new business vertical = add one overlay file + one registry entry.
 */
export const BUSINESS_MODULE_OVERLAYS: Partial<Record<BusinessTypeId, BusinessModuleOverlay>> = {
  [insuranceAgencyModule.businessType]: insuranceAgencyModule,
};
