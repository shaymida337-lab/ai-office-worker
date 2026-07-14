import assert from "node:assert/strict";
import test from "node:test";
import { resolveAppointmentDrawerContactActions } from "./appointmentDrawerContacts.js";

test("when phone/email/clientId exist, all four contact actions are active", () => {
  const actions = resolveAppointmentDrawerContactActions({
    clientId: "client-123",
    client: {
      id: "client-123",
      phone: "050-123-4567",
      whatsappNumber: "050-123-4567",
      email: "dana@example.com",
      emailIsPlaceholder: false,
    },
  });

  assert.equal(actions.telHref, "tel:+972501234567");
  assert.equal(actions.waHref, "https://wa.me/972501234567");
  assert.equal(actions.mailHref, "mailto:dana@example.com");
  assert.equal(actions.openClientPath, "/dashboard/clients/client-123");
  assert.ok(actions.telHref && actions.waHref && actions.mailHref && actions.openClientPath);
});

test("uses client.id when clientId on appointment is missing", () => {
  const actions = resolveAppointmentDrawerContactActions({
    clientId: "",
    client: {
      id: "from-client-object",
      phone: "0529998888",
      email: "a@b.com",
    },
  });
  assert.equal(actions.openClientPath, "/dashboard/clients/from-client-object");
  assert.equal(actions.telHref, "tel:+972529998888");
  assert.equal(actions.mailHref, "mailto:a@b.com");
});

test("reads email from embedded appointment.client without waiting for fetch", () => {
  const actions = resolveAppointmentDrawerContactActions({
    clientId: "c1",
    client: {
      id: "c1",
      email: "academy@danayehuda.com",
      emailIsPlaceholder: false,
      phone: null,
      whatsappNumber: null,
    },
    fetched: null,
  });
  assert.equal(actions.mailHref, "mailto:academy@danayehuda.com");
  assert.equal(actions.telHref, null);
  assert.equal(actions.waHref, null);
  assert.equal(actions.openClientPath, "/dashboard/clients/c1");
});

test("AppointmentDetailsDrawer wires four testids and real href helpers", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(
    new URL("../../components/calendar/AppointmentDetailsDrawer.tsx", import.meta.url),
    "utf8"
  );
  assert.match(source, /resolveAppointmentDrawerContactActions/);
  assert.match(source, /data-testid="appt-action-call"/);
  assert.match(source, /data-testid="appt-action-whatsapp"/);
  assert.match(source, /data-testid="appt-action-email"/);
  assert.match(source, /data-testid="appt-action-open-client"/);
  assert.match(source, /data-testid="back-to-calendar"/);
  assert.match(source, /router\.push\(openClientPath\)/);
  assert.match(source, /href=\{telHref\}/);
  assert.match(source, /href=\{waHref\}/);
  assert.match(source, /href=\{mailHref\}/);
  assert.match(source, /createPortal|SlidePanel/);
});
