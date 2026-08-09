import { classifyOcrSupplierText, detectSupplierKeyword } from "./src/services/gmail-sync.ts";

const yellow = [
  "אגורות 10-ו yellow בחנויות 10% צוברים מועדון חברי",
  ".לארנק ₪ 5.57 לצבור יכולת זו בקניה !בפז בתדלוק",
  "ישראכרט - ויזה",
  "05361***********",
].join("\n");

const superpharm = [
  "סופר פארם",
  "קבלה",
  "סה״כ לתשלום 45.00",
  "ישראכרט - ויזה",
  "4580************",
].join("\n");

const isracardStatement = "ישרא כרט פירוט עסקאות לחודש מרץ";
const cardOnlyPayment = ["ישראכרט - ויזה", "05361***********"].join("\n");
const maxCase = "max פירוט חיובי כרטיס אשראי";
const calCase = "ויזה כאל דף חשבון חיוב אשראי";

const out = {
  yellow: classifyOcrSupplierText(yellow)?.supplierName ?? null,
  superpharm: classifyOcrSupplierText(superpharm)?.supplierName ?? null,
  isracardStatement: classifyOcrSupplierText(isracardStatement)?.supplierName ?? null,
  cardOnlyPayment: classifyOcrSupplierText(cardOnlyPayment)?.supplierName ?? null,
  max: detectSupplierKeyword(maxCase)?.supplierName ?? null,
  cal: detectSupplierKeyword(calCase)?.supplierName ?? null,
};

console.log(JSON.stringify(out, null, 2));

const expected = {
  yellow: "פז",
  superpharm: "סופר פארם",
  isracardStatement: "ישראכרט",
  cardOnlyPayment: "ישראכרט",
  max: "max",
  cal: "כאל",
};

let ok = true;
for (const [k, v] of Object.entries(expected)) {
  if ((out as Record<string, string | null>)[k] !== v) {
    console.error(`FAIL ${k}: got=${(out as Record<string, string | null>)[k]} expected=${v}`);
    ok = false;
  }
}
if (!ok) process.exit(1);
console.log("scenario_verify=PASS");
