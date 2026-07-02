import test from "node:test";
import assert from "node:assert/strict";

import {
  PLATFORM_PERMISSIONS,
  PLATFORM_ROLES,
  checkPermission,
  getEffectivePermissions,
  roleGrantsPermission,
  permissionsForRole,
  canAssignRole,
  assignableRolesForActor,
  isPlatformPermission,
  resetRbacReliabilityDedupeForTests,
} from "./index.js";
import type { PlatformRole, PlatformPermission } from "./permissions.js";
import { resolveMembershipRole } from "./membership.js";
import type { MembershipDb } from "./membership.js";
import { emitPermissionDeniedReliability } from "./rbacReliability.js";

function mockMembershipDb(role: PlatformRole | null, ownerUserId = "user-1"): MembershipDb {
  return {
    organizationMember: {
      findUnique: async () =>
        role
          ? {
              id: "mbr-1",
              role,
            }
          : null,
    },
    organization: {
      findUnique: async () => ({ userId: ownerUserId }),
    },
  } as unknown as MembershipDb;
}

test("owner has all explicit permissions", () => {
  for (const permission of PLATFORM_PERMISSIONS) {
    assert.equal(roleGrantsPermission("owner", permission), true);
  }
});

test("read_only cannot perform financial mutations", () => {
  const denied: PlatformPermission[] = [
    "payment.create",
    "payment.update",
    "payment.delete",
    "invoice.update",
    "invoice.delete",
    "review.approve",
    "review.reject",
  ];
  for (const permission of denied) {
    assert.equal(roleGrantsPermission("read_only", permission), false);
  }
});

test("accountant can approve reviews but cannot delete payments", () => {
  assert.equal(roleGrantsPermission("accountant", "review.approve"), true);
  assert.equal(roleGrantsPermission("accountant", "payment.delete"), false);
  assert.equal(roleGrantsPermission("accountant", "organization.settings"), false);
  assert.equal(roleGrantsPermission("accountant", "users.invite"), false);
});

test("employee can upload documents and chat but not approve", () => {
  assert.equal(roleGrantsPermission("employee", "document.upload"), true);
  assert.equal(roleGrantsPermission("employee", "chat.use"), true);
  assert.equal(roleGrantsPermission("employee", "review.approve"), false);
  assert.equal(roleGrantsPermission("employee", "integrations.gmail.connect"), false);
});

test("admin cannot delete organization", () => {
  assert.equal(roleGrantsPermission("admin", "organization.delete"), false);
  assert.equal(roleGrantsPermission("admin", "organization.settings"), true);
});

test("deny by default for unknown permission", async () => {
  const result = await checkPermission({
    userId: "user-1",
    organizationId: "org-1",
    permission: "not.a.real.permission",
  });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /Unknown permission/);
});

test("organization isolation — non-member denied", async () => {
  const db = mockMembershipDb(null, "other-user");
  const membership = await resolveMembershipRole("user-2", "org-1", db);
  assert.equal(membership, null);
});

test("legacy org owner fallback resolves as owner", async () => {
  const db = mockMembershipDb(null, "user-1");
  const membership = await resolveMembershipRole("user-1", "org-1", db);
  assert.equal(membership?.role, "owner");
  assert.equal(membership?.isOrganizationOwner, true);
});

test("getEffectivePermissions returns explicit permission list per role", () => {
  const readOnly = getEffectivePermissions("read_only");
  assert.ok(readOnly.includes("dashboard.view"));
  assert.ok(!readOnly.includes("payment.update"));

  const owner = getEffectivePermissions("owner");
  assert.equal(owner.length, PLATFORM_PERMISSIONS.length);
});

test("every role in matrix only contains known permissions", () => {
  for (const role of PLATFORM_ROLES) {
    for (const permission of permissionsForRole(role)) {
      assert.ok(isPlatformPermission(permission), `${role} has unknown permission ${permission}`);
    }
  }
});

test("admin cannot assign owner role", () => {
  assert.equal(canAssignRole("admin", "owner"), false);
  assert.equal(canAssignRole("owner", "owner"), true);
  assert.deepEqual(assignableRolesForActor("admin"), ["admin", "accountant", "employee", "read_only"]);
});

test("permission denial emits IMPORTANT reliability event", () => {
  resetRbacReliabilityDedupeForTests();
  const event = emitPermissionDeniedReliability({
    organizationId: "org-1",
    userId: "user-1",
    permission: "payment.delete",
    role: "employee",
    reason: "denied",
  });
  assert.equal(event?.severity, "IMPORTANT");
  assert.equal(event?.stage, "rbac_denied");
});

test("forbidden financial actions for employee role", () => {
  const financialMutations: PlatformPermission[] = [
    "payment.create",
    "payment.update",
    "payment.delete",
    "review.approve",
    "invoice.delete",
  ];
  for (const permission of financialMutations) {
    assert.equal(roleGrantsPermission("employee", permission), false, permission);
  }
});

test("calendar permissions matrix is explicit and consistent", () => {
  const calendarPermissions: PlatformPermission[] = [
    "calendar.view",
    "calendar.create",
    "calendar.update",
    "calendar.cancel",
    "calendar.reschedule",
    "calendar.approve_decision",
  ];

  for (const permission of calendarPermissions) {
    assert.equal(roleGrantsPermission("owner", permission), true, `owner should allow ${permission}`);
    assert.equal(roleGrantsPermission("admin", permission), true, `admin should allow ${permission}`);
  }

  assert.equal(roleGrantsPermission("employee", "calendar.view"), true);
  assert.equal(roleGrantsPermission("employee", "calendar.create"), true);
  assert.equal(roleGrantsPermission("employee", "calendar.approve_decision"), false);

  assert.equal(roleGrantsPermission("read_only", "calendar.view"), true);
  assert.equal(roleGrantsPermission("read_only", "calendar.create"), false);
  assert.equal(roleGrantsPermission("read_only", "calendar.cancel"), false);
});
