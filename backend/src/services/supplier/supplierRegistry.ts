import { normalizeSupplierName, normalizeSupplierTaxId } from "../dedup/sharedMatcher.js";
import type { SupplierDNA, SupplierDNACategory } from "./supplierTypes.js";
import { normalizeSupplierDisplayName } from "./supplierValidation.js";

export type SupplierHistoryRow = {
  supplier: string;
  supplierTaxId?: string | null;
  supplierName?: string | null;
  emailSender?: string | null;
  approvalStatus?: string | null;
  createdAt?: Date | string | null;
};

function normalizeAliasKey(value: string) {
  return normalizeSupplierName(value);
}

function uniqueStrings(values: Array<string | null | undefined>) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

export function buildGlobalSupplierDnaSeed(): SupplierDNA[] {
  return [
    {
      canonicalSupplier: "iec",
      canonicalName: "חברת החשמל",
      normalizedName: normalizeSupplierName("חברת החשמל"),
      aliases: ["חברת החשמל לישראל", "Israel Electric Corporation", "IEC"],
      ocrVariants: ["חברתהחשמל", "חברת החשמל לישראל בע\"מ"],
      vatNumber: "520000391",
      emailDomains: ["iec.co.il"],
      knownEmails: ["billing@iec.co.il"],
      knownPhones: [],
      category: "utility",
      isBlocklisted: false,
      typicalLanguage: "he",
      typicalCurrency: "ILS",
      historicalConfidence: 0.95,
      correctionsCount: 0,
      invoicesCount: 0,
      firstSeenAt: null,
      lastSeenAt: null,
    },
    {
      canonicalSupplier: "paz",
      canonicalName: "פז",
      normalizedName: normalizeSupplierName("פז"),
      aliases: ["Paz", "PAZ", "פז ילו", "פז-ילו", "Yellow", "yellow", "תדלוק פז"],
      ocrVariants: ["paz", "yellow", "פזילו"],
      vatNumber: null,
      emailDomains: ["paz.co.il"],
      knownEmails: [],
      knownPhones: [],
      category: "other",
      isBlocklisted: false,
      typicalLanguage: "he",
      typicalCurrency: "ILS",
      historicalConfidence: 0.95,
      correctionsCount: 0,
      invoicesCount: 0,
      firstSeenAt: null,
      lastSeenAt: null,
    },
    {
      canonicalSupplier: "wolt",
      canonicalName: "Wolt",
      normalizedName: normalizeSupplierName("Wolt"),
      aliases: ["וולט", "Wolt Technologies"],
      ocrVariants: ["וולט", "wolt"],
      vatNumber: null,
      emailDomains: ["wolt.com"],
      knownEmails: [],
      knownPhones: [],
      category: "saas",
      isBlocklisted: false,
      typicalLanguage: "mixed",
      typicalCurrency: "ILS",
      historicalConfidence: 0.9,
      correctionsCount: 0,
      invoicesCount: 0,
      firstSeenAt: null,
      lastSeenAt: null,
    },
    {
      canonicalSupplier: "openai",
      canonicalName: "OpenAI",
      normalizedName: normalizeSupplierName("OpenAI"),
      aliases: ["OpenAI LLC", "OpenAI, LLC"],
      ocrVariants: ["openai", "open ai"],
      vatNumber: null,
      emailDomains: ["openai.com"],
      knownEmails: ["billing@openai.com"],
      knownPhones: [],
      category: "saas",
      isBlocklisted: false,
      typicalLanguage: "en",
      typicalCurrency: "USD",
      historicalConfidence: 0.9,
      correctionsCount: 0,
      invoicesCount: 0,
      firstSeenAt: null,
      lastSeenAt: null,
    },
    {
      canonicalSupplier: "bank-blocked",
      canonicalName: "Bank Hapoalim",
      normalizedName: normalizeSupplierName("Bank Hapoalim"),
      aliases: ["הפועלים", "בנק הפועלים"],
      ocrVariants: [],
      vatNumber: null,
      emailDomains: ["bankhapoalim.co.il"],
      knownEmails: [],
      knownPhones: [],
      category: "bank",
      isBlocklisted: true,
      typicalLanguage: "he",
      typicalCurrency: "ILS",
      historicalConfidence: 0,
      correctionsCount: 0,
      invoicesCount: 0,
      firstSeenAt: null,
      lastSeenAt: null,
    },
  ];
}

export function mergeSupplierRegistries(...registries: SupplierDNA[][]) {
  const byKey = new Map<string, SupplierDNA>();
  for (const registry of registries) {
    for (const entry of registry) {
      const existing = byKey.get(entry.canonicalSupplier);
      if (!existing) {
        byKey.set(entry.canonicalSupplier, {
          ...entry,
          aliases: uniqueStrings(entry.aliases),
          ocrVariants: uniqueStrings(entry.ocrVariants),
          emailDomains: uniqueStrings(entry.emailDomains),
          knownEmails: uniqueStrings(entry.knownEmails),
          knownPhones: uniqueStrings(entry.knownPhones),
        });
        continue;
      }
      byKey.set(entry.canonicalSupplier, {
        ...existing,
        canonicalName: existing.canonicalName || entry.canonicalName,
        vatNumber: existing.vatNumber ?? entry.vatNumber,
        aliases: uniqueStrings([...existing.aliases, ...entry.aliases, entry.canonicalName]),
        ocrVariants: uniqueStrings([...existing.ocrVariants, ...entry.ocrVariants]),
        emailDomains: uniqueStrings([...existing.emailDomains, ...entry.emailDomains]),
        knownEmails: uniqueStrings([...existing.knownEmails, ...entry.knownEmails]),
        knownPhones: uniqueStrings([...existing.knownPhones, ...entry.knownPhones]),
        invoicesCount: Math.max(existing.invoicesCount, entry.invoicesCount),
        correctionsCount: Math.max(existing.correctionsCount, entry.correctionsCount),
        historicalConfidence: Math.max(existing.historicalConfidence, entry.historicalConfidence),
        firstSeenAt: existing.firstSeenAt ?? entry.firstSeenAt,
        lastSeenAt: existing.lastSeenAt ?? entry.lastSeenAt,
        isBlocklisted: existing.isBlocklisted || entry.isBlocklisted,
      });
    }
  }
  return [...byKey.values()];
}

export function lookupSupplierByVat(registry: SupplierDNA[], vatNumber?: string | null) {
  const normalized = normalizeSupplierTaxId(vatNumber);
  if (!normalized) return null;
  return registry.find((entry) => normalizeSupplierTaxId(entry.vatNumber) === normalized) ?? null;
}

export function lookupSupplierByAlias(registry: SupplierDNA[], name: string) {
  const normalized = normalizeAliasKey(name);
  if (!normalized) return null;
  for (const entry of registry) {
    const keys = [
      entry.canonicalName,
      ...entry.aliases,
      ...entry.ocrVariants,
    ].map(normalizeAliasKey);
    if (keys.includes(normalized)) return entry;
  }
  return null;
}

export function lookupSupplierByDomain(registry: SupplierDNA[], domain: string) {
  const cleaned = domain.trim().toLowerCase().replace(/^www\./, "");
  if (!cleaned) return null;
  return registry.find((entry) => entry.emailDomains.some((value) => cleaned === value || cleaned.endsWith(`.${value}`))) ?? null;
}

export function resolveCanonicalDisplayName(entry: SupplierDNA, fallbackName: string) {
  return normalizeSupplierDisplayName(entry.canonicalName || fallbackName);
}

export function seedSupplierDnaFromHistory(rows: SupplierHistoryRow[]): SupplierDNA[] {
  const clusters = new Map<string, {
    names: Map<string, number>;
    vatNumber: string | null;
    domains: Set<string>;
    invoicesCount: number;
    firstSeenAt: string | null;
    lastSeenAt: string | null;
  }>();

  for (const row of rows) {
    const rawName = row.supplierName?.trim() || row.supplier?.trim();
    if (!rawName) continue;
    const normalized = normalizeSupplierName(rawName);
    if (!normalized) continue;

    const cluster = clusters.get(normalized) ?? {
      names: new Map<string, number>(),
      vatNumber: null,
      domains: new Set<string>(),
      invoicesCount: 0,
      firstSeenAt: null,
      lastSeenAt: null,
    };

    cluster.names.set(rawName, (cluster.names.get(rawName) ?? 0) + 1);
    const vat = normalizeSupplierTaxId(row.supplierTaxId);
    if (vat) cluster.vatNumber = cluster.vatNumber ?? vat;
    const sender = row.emailSender?.trim().toLowerCase() ?? "";
    const domain = sender.includes("@") ? sender.split("@")[1] : "";
    if (domain) cluster.domains.add(domain);
    cluster.invoicesCount += 1;
    const createdAt = row.createdAt ? new Date(row.createdAt).toISOString() : null;
    if (createdAt) {
      cluster.firstSeenAt = !cluster.firstSeenAt || createdAt < cluster.firstSeenAt ? createdAt : cluster.firstSeenAt;
      cluster.lastSeenAt = !cluster.lastSeenAt || createdAt > cluster.lastSeenAt ? createdAt : cluster.lastSeenAt;
    }
    clusters.set(normalized, cluster);
  }

  const seeded: SupplierDNA[] = [];
  for (const [normalizedName, cluster] of clusters.entries()) {
    const canonicalName = [...cluster.names.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!canonicalName) continue;
    const aliases = [...cluster.names.keys()].filter((name) => name !== canonicalName);
    seeded.push({
      canonicalSupplier: `hist:${normalizedName}`,
      canonicalName,
      normalizedName,
      aliases,
      ocrVariants: [],
      vatNumber: cluster.vatNumber,
      emailDomains: [...cluster.domains],
      knownEmails: [],
      knownPhones: [],
      category: "other" as SupplierDNACategory,
      isBlocklisted: false,
      typicalLanguage: /[\u0590-\u05FF]/u.test(canonicalName) ? "he" : "en",
      typicalCurrency: "ILS",
      historicalConfidence: Math.min(0.85, 0.5 + cluster.invoicesCount * 0.05),
      correctionsCount: 0,
      invoicesCount: cluster.invoicesCount,
      firstSeenAt: cluster.firstSeenAt,
      lastSeenAt: cluster.lastSeenAt,
    });
  }
  return seeded;
}

export function registryForOrganization(input: {
  organizationId: string;
  historyRows?: SupplierHistoryRow[];
  extraEntries?: SupplierDNA[];
}) {
  const historySeed = seedSupplierDnaFromHistory(input.historyRows ?? []);
  return mergeSupplierRegistries(buildGlobalSupplierDnaSeed(), historySeed, input.extraEntries ?? []);
}
