/**
 * טסט אינטגרציה לחיפוש במסך רשימת הלקוחות: מדמה לקוחה בשם שרית וגם ליד
 * בשם שרית, ומוודא ששניהם עוברים את אותה צנרת סינון ומגיעים לתוצאות —
 * הלקוחה במסלול /dashboard/clients/<id> והליד במסלול /crm?lead=<id>.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildClientsListSearch, type SearchableLead } from "./clientsListSearch";

const saritClient = {
  id: "client-sarit",
  name: "שרית אברהם",
  email: "sarit.a@example.com",
  phone: "+972501234567",
  whatsappNumber: "0501234567",
};
const yossiClient = { id: "client-yossi", name: "יוסי מזרחי", email: "yossi@example.com" };
const saritLead: SearchableLead = {
  id: "lead-sarit",
  name: "שרית לוי",
  phone: "0537777777",
  email: "sarit.l@example.com",
  whatsapp: null,
};

test("חיפוש 'שרית' מחזיר גם את הלקוחה וגם את הליד", () => {
  const result = buildClientsListSearch({
    clients: [saritClient, yossiClient],
    leads: [saritLead],
    query: "שרית",
  });
  assert.deepEqual(result.clients.map((c) => c.name), ["שרית אברהם"]);
  assert.deepEqual(result.leads.map((l) => l.name), ["שרית לוי"]);
});

test("שדה חיפוש ריק — לקוחות בלבד, בלי לידים (ההתנהגות הקיימת)", () => {
  const result = buildClientsListSearch({
    clients: [saritClient, yossiClient],
    leads: [saritLead],
    query: "",
  });
  assert.equal(result.clients.length, 2, "כל הלקוחות מוצגים");
  assert.equal(result.leads.length, 0, "לידים לא מוצגים בלי חיפוש");
});

test("לקוחות רגילים ממשיכים לעבוד — חיפוש 'יוסי' מחזיר לקוח בלי לידים", () => {
  const result = buildClientsListSearch({
    clients: [saritClient, yossiClient],
    leads: [saritLead],
    query: "יוסי",
  });
  assert.deepEqual(result.clients.map((c) => c.name), ["יוסי מזרחי"]);
  assert.equal(result.leads.length, 0);
});

test("ליד נמצא גם לפי טלפון בפורמט שונה (נרמול ספרות משותף)", () => {
  const result = buildClientsListSearch({
    clients: [],
    leads: [saritLead],
    query: "+972537777777",
  });
  assert.deepEqual(result.leads.map((l) => l.id), ["lead-sarit"]);
});

test("מסך הלקוחות מחווט נכון: ליד נפתח ב-/crm?lead=<id> ולקוח בכרטיס הקנוני", async () => {
  const source = await readFile("src/app/dashboard/clients/page.tsx", "utf8");
  assert.match(source, /buildClientsListSearch/, "הרשימה עוברת דרך צנרת החיפוש המשותפת");
  assert.match(source, /\/crm\?lead=\$\{encodeURIComponent\(lead\.id\)\}/, "לחיצה על ליד פותחת את מסלול הליד הקיים");
  assert.match(source, /\/dashboard\/clients\/\$\{client\.id\}/, "לחיצה על לקוח פותחת את כרטיס הלקוח");
  assert.match(source, />ליד<\/span>/, "תגית 'ליד' מוצגת על תוצאת ליד");
});
