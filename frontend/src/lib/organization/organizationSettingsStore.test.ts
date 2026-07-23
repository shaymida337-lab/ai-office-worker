import assert from "node:assert/strict";
import test from "node:test";
import type { OrganizationSettings } from "@/lib/business-config";
import {
  ORGANIZATION_SETTINGS_FRESH_MS,
  ORGANIZATION_SETTINGS_TTL_MS,
  __getOrganizationSettingsStoreSnapshotForTests,
  __resetOrganizationSettingsStoreForTests,
  __setOrganizationSettingsAuthKeyForTests,
  __setOrganizationSettingsFetchForTests,
  clearOrganizationSettingsCache,
  getCachedOrganizationSettings,
  loadOrganizationSettings,
  setOrganizationSettingsCache,
  subscribeOrganizationSettings,
} from "./organizationSettingsStore";

function settings(partial: Partial<OrganizationSettings> & Pick<OrganizationSettings, "id" | "name">): OrganizationSettings {
  return {
    id: partial.id,
    name: partial.name,
    businessName: partial.businessName ?? partial.name,
    businessType: partial.businessType ?? "service_business",
    businessSize: partial.businessSize ?? "solo",
    mainBusinessPain: partial.mainBusinessPain ?? null,
    enabledModules: partial.enabledModules ?? ["crm", "tasks"],
    onboardingCompleted: partial.onboardingCompleted ?? true,
    onboardingRequired: partial.onboardingRequired ?? false,
    recommendedModules: partial.recommendedModules ?? ["crm"],
    locale: partial.locale ?? "he-IL",
    language: partial.language ?? "he",
    country: partial.country ?? "IL",
    currency: partial.currency ?? "ILS",
    timezone: partial.timezone ?? "Asia/Jerusalem",
    dateFormat: partial.dateFormat ?? "dd/MM/yyyy",
    timeFormat: partial.timeFormat ?? "24h",
    weekStart: partial.weekStart ?? "sunday",
    phoneCountryCode: partial.phoneCountryCode ?? "IL",
  };
}

async function withAuth(token: string, run: () => Promise<void> | void) {
  __resetOrganizationSettingsStoreForTests();
  __setOrganizationSettingsAuthKeyForTests(() => token);
  try {
    await run();
  } finally {
    __resetOrganizationSettingsStoreForTests();
  }
}

test("three parallel consumers share one network request and the same response", async () => {
  await withAuth("org-a-token", async () => {
    let calls = 0;
    const payload = settings({ id: "org-a", name: "עסק א" });
    __setOrganizationSettingsFetchForTests(async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 20));
      return payload;
    });

    const [a, b, c] = await Promise.all([
      loadOrganizationSettings(),
      loadOrganizationSettings(),
      loadOrganizationSettings(),
    ]);

    assert.equal(calls, 1);
    assert.equal(a, b);
    assert.equal(b, c);
    assert.equal(a.id, "org-a");
    assert.equal(getCachedOrganizationSettings()?.id, "org-a");
  });
});

test("revisit within fresh window does not network", async () => {
  await withAuth("org-a-token", async () => {
    let calls = 0;
    __setOrganizationSettingsFetchForTests(async () => {
      calls += 1;
      return settings({ id: "org-a", name: "עסק א" });
    });

    await loadOrganizationSettings();
    assert.equal(calls, 1);
    await loadOrganizationSettings();
    await loadOrganizationSettings();
    assert.equal(calls, 1);
  });
});

test("stale value returns immediately and refreshes in background", async () => {
  await withAuth("org-a-token", async () => {
    let calls = 0;
    __setOrganizationSettingsFetchForTests(async () => {
      await new Promise((r) => setTimeout(r, 15));
      calls += 1;
      return settings({
        id: "org-a",
        name: calls === 1 ? "ישן" : "חדש",
        businessName: calls === 1 ? "ישן" : "חדש",
      });
    });

    const first = await loadOrganizationSettings();
    assert.equal(first.businessName, "ישן");
    assert.equal(calls, 1);

    const realNow = Date.now;
    let now = realNow();
    Date.now = () => now;
    try {
      // Re-seed so loadedAt follows mocked clock.
      setOrganizationSettingsCache(first);
      now += ORGANIZATION_SETTINGS_FRESH_MS + 1;

      const stale = await loadOrganizationSettings();
      assert.equal(stale.businessName, "ישן");
      // Background revalidate started but has not finished yet (increment is after delay).
      assert.equal(calls, 1);

      await new Promise((r) => setTimeout(r, 40));
      assert.equal(calls, 2);
      assert.equal(getCachedOrganizationSettings()?.businessName, "חדש");
      assert.ok(__getOrganizationSettingsStoreSnapshotForTests().loadedAt);
    } finally {
      Date.now = realNow;
    }
  });
});

test("setOrganizationSettingsCache updates subscribers immediately (settings save)", async () => {
  await withAuth("org-a-token", async () => {
    const seen: string[] = [];
    const unsub = subscribeOrganizationSettings(() => {
      seen.push(getCachedOrganizationSettings()?.businessName ?? "");
    });
    setOrganizationSettingsCache(settings({ id: "org-a", name: "נטלי", businessName: "נטלי בע״מ" }));
    unsub();
    assert.deepEqual(seen, ["נטלי בע״מ"]);
    assert.equal(getCachedOrganizationSettings()?.businessName, "נטלי בע״מ");
  });
});

test("refresh failure keeps existing cache", async () => {
  await withAuth("org-a-token", async () => {
    let calls = 0;
    __setOrganizationSettingsFetchForTests(async () => {
      calls += 1;
      if (calls === 1) return settings({ id: "org-a", name: "שמור", businessName: "שמור" });
      throw new Error("network down");
    });

    await loadOrganizationSettings();
    const realNow = Date.now;
    let now = realNow();
    Date.now = () => now;
    try {
      setOrganizationSettingsCache(settings({ id: "org-a", name: "שמור", businessName: "שמור" }));
      now += ORGANIZATION_SETTINGS_TTL_MS + 1;
      const kept = await loadOrganizationSettings();
      assert.equal(kept.businessName, "שמור");
      assert.equal(getCachedOrganizationSettings()?.businessName, "שמור");
      assert.equal(calls, 2);
    } finally {
      Date.now = realNow;
    }
  });
});

test("organization isolation: different auth tokens do not share cache", async () => {
  await withAuth("token-a", async () => {
    __setOrganizationSettingsFetchForTests(async () => settings({ id: "org-a", name: "A", businessName: "A" }));
    await loadOrganizationSettings();
    assert.equal(getCachedOrganizationSettings()?.id, "org-a");
  });

  await withAuth("token-b", async () => {
    let calls = 0;
    __setOrganizationSettingsFetchForTests(async () => {
      calls += 1;
      return settings({ id: "org-b", name: "B", businessName: "B" });
    });
    const value = await loadOrganizationSettings();
    assert.equal(calls, 1);
    assert.equal(value.id, "org-b");
    assert.equal(getCachedOrganizationSettings()?.id, "org-b");
  });
});

test("cross-org: cached org-a is ignored when token switches before read", async () => {
  __resetOrganizationSettingsStoreForTests();
  let token = "token-a";
  __setOrganizationSettingsAuthKeyForTests(() => token);
  __setOrganizationSettingsFetchForTests(async () =>
    settings({ id: token === "token-a" ? "org-a" : "org-b", name: token, businessName: token })
  );

  try {
    await loadOrganizationSettings();
    assert.equal(getCachedOrganizationSettings()?.id, "org-a");

    token = "token-b";
    assert.equal(getCachedOrganizationSettings(), null);
    const next = await loadOrganizationSettings();
    assert.equal(next.id, "org-b");
  } finally {
    __resetOrganizationSettingsStoreForTests();
  }
});

test("clearOrganizationSettingsCache drops value", async () => {
  await withAuth("org-a-token", async () => {
    setOrganizationSettingsCache(settings({ id: "org-a", name: "X" }));
    clearOrganizationSettingsCache();
    assert.equal(getCachedOrganizationSettings(), null);
  });
});

test("clearAllAuthTokens clears org settings cache synchronously before next token", async () => {
  await withAuth("token-a", async () => {
    setOrganizationSettingsCache(settings({ id: "org-a", name: "A", businessName: "A" }));
    assert.equal(getCachedOrganizationSettings()?.id, "org-a");

    // Simulate logout/login bridge: clear auth key + sync cache clear used by api.clearAllAuthTokens.
    const { clearOrganizationSettingsCacheNow } = await import("./organizationSettingsCacheClear");
    clearOrganizationSettingsCacheNow();
    __setOrganizationSettingsAuthKeyForTests(() => "token-b");

    assert.equal(getCachedOrganizationSettings(), null);
  });
});

test("TTL constants match product plan", () => {
  assert.equal(ORGANIZATION_SETTINGS_FRESH_MS, 30_000);
  assert.equal(ORGANIZATION_SETTINGS_TTL_MS, 5 * 60_000);
});
