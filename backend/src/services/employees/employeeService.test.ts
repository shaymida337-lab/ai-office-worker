import test from "node:test";
import assert from "node:assert/strict";
import type { prisma } from "../../lib/prisma.js";
import {
  addEmployeeVacation,
  createEmployee,
  deleteEmployee,
  setEmployeeWorkingHours,
  setServiceEmployees,
  updateEmployee,
  validateEmployeeBooking,
} from "./employeeService.js";

const TZ = "Asia/Jerusalem";

type MockDb = typeof prisma;

/**
 * DB מדומה מינימלי — כל טסט מזין רק את מה שהוא צריך. אותו דפוס DI כמו
 * בטסטים של cameraIngestion: הקוד האמיתי רץ, רק שכבת prisma מוחלפת.
 */
function buildMockDb(state: {
  employee?: Record<string, unknown> | null;
  appointments?: Array<{ id: string; startTime: Date; durationMinutes: number }>;
  futureAppointmentCount?: number;
  serviceLinks?: Array<{ employeeId: string }>;
  ownedEmployeeCount?: number;
}) {
  const calls: Record<string, unknown[]> = {};
  const track = (name: string, args: unknown) => {
    (calls[name] ??= []).push(args);
  };
  const db = {
    employee: {
      findFirst: async (args: unknown) => {
        track("employee.findFirst", args);
        return state.employee ?? null;
      },
      findMany: async () => [],
      count: async () => state.ownedEmployeeCount ?? 0,
      create: async (args: { data: Record<string, unknown> }) => {
        track("employee.create", args);
        return { id: "emp-new", ...args.data, workingHours: [], vacations: [], serviceLinks: [] };
      },
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        track("employee.update", args);
        return { ...(state.employee as object), ...args.data, workingHours: [], vacations: [], serviceLinks: [] };
      },
      delete: async (args: unknown) => {
        track("employee.delete", args);
        return state.employee;
      },
    },
    appointment: {
      count: async () => state.futureAppointmentCount ?? 0,
      findMany: async (args: unknown) => {
        track("appointment.findMany", args);
        return state.appointments ?? [];
      },
    },
    employeeWorkingHours: {
      deleteMany: (args: unknown) => {
        track("workingHours.deleteMany", args);
        return Promise.resolve({ count: 0 });
      },
      createMany: (args: unknown) => {
        track("workingHours.createMany", args);
        return Promise.resolve({ count: 1 });
      },
    },
    employeeVacation: {
      create: async (args: { data: Record<string, unknown> }) => {
        track("vacation.create", args);
        return { id: "vac-1", ...args.data };
      },
      deleteMany: async () => ({ count: 1 }),
    },
    serviceEmployee: {
      findMany: async () => state.serviceLinks ?? [],
      deleteMany: (args: unknown) => {
        track("serviceEmployee.deleteMany", args);
        return Promise.resolve({ count: 0 });
      },
      createMany: (args: unknown) => {
        track("serviceEmployee.createMany", args);
        return Promise.resolve({ count: 1 });
      },
    },
    $transaction: async (operations: Array<Promise<unknown>>) => Promise.all(operations),
  } as unknown as MockDb;
  return { db, calls };
}

const ACTIVE_EMPLOYEE = {
  id: "emp-1",
  organizationId: "org-1",
  name: "דנה",
  isActive: true,
  workingHours: [
    { dayOfWeek: 3, startTime: "09:00", endTime: "17:00", breaksJson: [{ start: "12:00", end: "12:30" }] },
  ],
  vacations: [{ startDate: "2026-07-20", endDate: "2026-07-22" }],
  serviceLinks: [],
};

// 09:00 מקומית ביום רביעי 15.7.2026 (קיץ, UTC+3)
const wednesday9Local = new Date(Date.UTC(2026, 6, 15, 6, 0));

test("createEmployee validates name and color; defaults applied", async () => {
  const { db } = buildMockDb({});
  const missingName = await createEmployee("org-1", { phone: "050" }, { db });
  assert.ok(!missingName.ok && missingName.error.includes("שם העובד"));
  const badColor = await createEmployee("org-1", { name: "דנה", color: "blue" }, { db });
  assert.ok(!badColor.ok && badColor.error.includes("צבע"));
  const created = await createEmployee("org-1", { name: " דנה ", phone: "050-1234567" }, { db });
  assert.ok(created.ok);
  assert.equal(created.ok && created.employee.name, "דנה");
  assert.equal(created.ok && (created.employee as { color?: string }).color, "#3B82F6");
});

test("updateEmployee: not found in another organization; disable via isActive", async () => {
  const notFound = await updateEmployee("org-1", "emp-x", { name: "x" }, { db: buildMockDb({ employee: null }).db });
  assert.ok(!notFound.ok && "notFound" in notFound && notFound.notFound);
  const { db } = buildMockDb({ employee: ACTIVE_EMPLOYEE });
  const disabled = await updateEmployee("org-1", "emp-1", { isActive: false }, { db });
  assert.ok(disabled.ok);
  assert.equal(disabled.ok && (disabled.employee as { isActive?: boolean }).isActive, false);
});

test("deleteEmployee blocked when future appointments exist; allowed otherwise", async () => {
  const blocked = await deleteEmployee("org-1", "emp-1", {
    db: buildMockDb({ employee: ACTIVE_EMPLOYEE, futureAppointmentCount: 2 }).db,
  });
  assert.ok(!blocked.ok && "conflict" in blocked && blocked.conflict);
  assert.ok(!blocked.ok && blocked.error.includes("2 תורים עתידיים"));
  const { db, calls } = buildMockDb({ employee: ACTIVE_EMPLOYEE, futureAppointmentCount: 0 });
  const deleted = await deleteEmployee("org-1", "emp-1", { db });
  assert.ok(deleted.ok);
  assert.equal(calls["employee.delete"]?.length, 1);
});

test("setEmployeeWorkingHours replaces the schedule atomically and rejects bad schedules", async () => {
  const { db, calls } = buildMockDb({ employee: ACTIVE_EMPLOYEE });
  const bad = await setEmployeeWorkingHours("org-1", "emp-1", [{ dayOfWeek: 1, startTime: "18:00", endTime: "09:00" }], { db });
  assert.ok(!bad.ok);
  const good = await setEmployeeWorkingHours(
    "org-1",
    "emp-1",
    [{ dayOfWeek: 1, startTime: "09:00", endTime: "17:00", breaks: [{ start: "13:00", end: "13:30" }] }],
    { db }
  );
  assert.ok(good.ok);
  assert.equal(calls["workingHours.deleteMany"]?.length, 1, "old schedule cleared");
  assert.equal(calls["workingHours.createMany"]?.length, 1, "new schedule written");
});

test("addEmployeeVacation validates the local date range", async () => {
  const { db } = buildMockDb({ employee: ACTIVE_EMPLOYEE });
  const bad = await addEmployeeVacation("org-1", "emp-1", { startDate: "2026-07-22", endDate: "2026-07-20" }, { db });
  assert.ok(!bad.ok);
  const singleDay = await addEmployeeVacation("org-1", "emp-1", { startDate: "2026-07-20" }, { db });
  assert.ok(singleDay.ok);
  assert.equal(singleDay.ok && (singleDay.vacation as { endDate?: string }).endDate, "2026-07-20");
});

test("setServiceEmployees rejects employees from another organization", async () => {
  const mismatch = await setServiceEmployees("org-1", "svc-1", ["emp-1", "emp-2"], {
    db: buildMockDb({ ownedEmployeeCount: 1 }).db,
  });
  assert.ok(!mismatch.ok);
  const { db, calls } = buildMockDb({ ownedEmployeeCount: 2 });
  const ok = await setServiceEmployees("org-1", "svc-1", ["emp-1", "emp-2", "emp-1"], { db });
  assert.ok(ok.ok);
  assert.deepEqual(ok.ok && ok.employeeIds, ["emp-1", "emp-2"], "duplicates removed");
  assert.equal(calls["serviceEmployee.deleteMany"]?.length, 1);
});

test("validateEmployeeBooking: full decision chain over loaded data", async () => {
  const base = {
    organizationId: "org-1",
    employeeId: "emp-1",
    startTime: wednesday9Local,
    durationMinutes: 60,
    timeZone: TZ,
  };

  const notFound = await validateEmployeeBooking({ ...base, deps: { db: buildMockDb({ employee: null }).db } });
  assert.equal(!notFound.ok && notFound.code, "employee_not_found");

  const inactive = await validateEmployeeBooking({
    ...base,
    deps: { db: buildMockDb({ employee: { ...ACTIVE_EMPLOYEE, isActive: false } }).db },
  });
  assert.equal(!inactive.ok && inactive.code, "employee_inactive");

  const serviceBlocked = await validateEmployeeBooking({
    ...base,
    serviceId: "svc-1",
    deps: { db: buildMockDb({ employee: ACTIVE_EMPLOYEE, serviceLinks: [{ employeeId: "emp-other" }] }).db },
  });
  assert.equal(!serviceBlocked.ok && serviceBlocked.code, "service_not_allowed");

  const serviceOpenToAll = await validateEmployeeBooking({
    ...base,
    serviceId: "svc-1",
    deps: { db: buildMockDb({ employee: ACTIVE_EMPLOYEE, serviceLinks: [] }).db },
  });
  assert.deepEqual(serviceOpenToAll, { ok: true }, "service without links is open to all employees");

  const outsideHours = await validateEmployeeBooking({
    ...base,
    startTime: new Date(Date.UTC(2026, 6, 15, 3, 0)), // 06:00 מקומית — לפני 09:00
    deps: { db: buildMockDb({ employee: ACTIVE_EMPLOYEE }).db },
  });
  assert.equal(!outsideHours.ok && outsideHours.code, "outside_working_hours");

  const onVacation = await validateEmployeeBooking({
    ...base,
    // 20.7.2026 הוא יום שני — נוסיף לוח ליום שני כדי לבדוד את חוק החופשה
    startTime: new Date(Date.UTC(2026, 6, 20, 6, 0)),
    deps: {
      db: buildMockDb({
        employee: {
          ...ACTIVE_EMPLOYEE,
          workingHours: [{ dayOfWeek: 1, startTime: "09:00", endTime: "17:00", breaksJson: [] }],
        },
      }).db,
    },
  });
  assert.equal(!onVacation.ok && onVacation.code, "on_vacation");

  const conflict = await validateEmployeeBooking({
    ...base,
    deps: {
      db: buildMockDb({
        employee: ACTIVE_EMPLOYEE,
        appointments: [{ id: "appt-1", startTime: new Date(Date.UTC(2026, 6, 15, 6, 30)), durationMinutes: 45 }],
      }).db,
    },
  });
  assert.equal(!conflict.ok && conflict.code, "time_conflict");

  const editSameAppointment = await validateEmployeeBooking({
    ...base,
    excludeAppointmentId: "appt-1",
    deps: {
      db: buildMockDb({ employee: ACTIVE_EMPLOYEE, appointments: [] }).db,
    },
  });
  assert.deepEqual(editSameAppointment, { ok: true });

  const allowed = await validateEmployeeBooking({ ...base, deps: { db: buildMockDb({ employee: ACTIVE_EMPLOYEE }).db } });
  assert.deepEqual(allowed, { ok: true });
});
