import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isGenericSingleEnglishWordName,
  isLikelyJunkSupplierName,
  looksLikeSentenceFragmentName,
} from "./supplierNameValidation.js";
import { GENERIC_SENDER_TOKENS, isUsableSupplierNameShared, isValidSupplierNameShared } from "./supplier/supplierValidation.js";

test("isLikelyJunkSupplierName blocks generic standalone English words that leaked as suppliers", () => {
  const junk = [
    "files",
    "Files",
    "FILES",
    "file",
    "documents",
    "scans",
    "scan",
    "invoices",
    "receipts",
    "image",
    "images",
    "attachment",
    "attachments",
    "temp",
    "test",
    "data",
    "folder",
    "upload",
    "uploads",
  ] as const;

  for (const name of junk) {
    assert.equal(isLikelyJunkSupplierName(name), true, `expected junk: ${name}`);
  }

  // ספקים אמיתיים חייבים לעבור — כולל עברית ושמות שמכילים מילה גנרית כחלק משם
  const valid = ["בזק", "חברת החשמל", "Data Supplier Ltd", "Test Kitchen בע\"מ"] as const;
  for (const name of valid) {
    assert.equal(isLikelyJunkSupplierName(name), false, `expected valid: ${name}`);
  }
});

test("isGenericSingleEnglishWordName: positive rule — single generic English word is suspect by default", () => {
  // מילים בודדות באנגלית בלי הקשר עסקי — חשודות (גם כאלה שאינן ב-blocklist)
  for (const name of ["misc", "stuff", "office", "cloud", "Services"]) {
    assert.equal(isGenericSingleEnglishWordName(name), true, `expected generic: ${name}`);
  }
  // לא חשודות: עברית, ריבוי מילים, מותגי camelCase, ספרות
  const notGeneric = [
    "בזק",
    "חברת החשמל",
    "Super Pharm",
    "PayPal",
    "iCount",
    "GoDaddy",
    "3M",
    "פיצה 2000",
    "Data Supplier Ltd",
  ] as const;
  for (const name of notGeneric) {
    assert.equal(isGenericSingleEnglishWordName(name), false, `expected not generic: ${name}`);
  }
});

test("isLikelyJunkSupplierName flags real-world garbage supplier values", () => {
  const junk = [
    'parsed)firstString =',
    "FieldsFromText",
    "detection",
    "review amounts to zero",
    "rawOcrText=supplier",
    "null",
    "undefined",
    "Unknown supplier",
    "unknown",
    "לא ידוע",
    "4. Inside each supplier",
    "a supplier (e.g. an expense the business pays like OpenAI or Netlify) does it",
  ] as const;

  for (const name of junk) {
    assert.equal(isLikelyJunkSupplierName(name), true, `expected junk: ${name}`);
  }
});

test("isLikelyJunkSupplierName flags placeholder and prompt-leak values (F1)", () => {
  const junk = [
    // placeholders בעברית שדלפו מתשובות מודל
    "לא זוהה",
    "לא צוין",
    "לא צויין",
    "לא נמצא",
    "חסר",
    // מילים גנריות שהוחזרו כ"ספק" כשהחילוץ נכשל
    "ספק",
    "שם הספק",
    "שם העסק",
    "חשבונית מס",
    "קבלה",
    "supplier name",
    "business name",
    "not specified",
    "not found",
    "no supplier",
    "placeholder",
    "TBD",
    "-",
    // שברי JSON מתשובת מודל
    '"supplier": "Acme"',
    '{"supplier"',
    "json",
    // קטעי משפט שנתפסו ברגקס מתוך גוף המייל
    "צוות התמיכה שלנו מצרף את החשבונית שלך בנושא החידוש",
    "please find attached your invoice for this month regarding renewal",
    "שם ארוך מאוד שהוא בעצם משפט שלם עם הרבה מאוד מילים שנתפס בטעות מרגקס",
  ] as const;

  for (const name of junk) {
    assert.equal(isLikelyJunkSupplierName(name), true, `expected junk: ${name}`);
  }
});

test("isLikelyJunkSupplierName allows legitimate supplier names", () => {
  const valid = [
    "חברת החשמל",
    "Wolt",
    "Anthropic PBC",
    "Anthropic, PBC",
    "וולט אנטרפרייזס ישראל",
    "Fraud Detection Ltd",
    "Super Pharm",
    "בזק",
    "בנק הפועלים",
    "Dana Mida",
    "Gett",
    "Namecheap",
  ] as const;

  for (const name of valid) {
    assert.equal(isLikelyJunkSupplierName(name), false, `expected valid: ${name}`);
  }
});

test("isLikelyJunkSupplierName allows real Israeli suppliers incl. numbers and short names (no false positives)", () => {
  const valid = [
    // שמות עם מספרים
    "פיצה 2000",
    "מוסך שלמה 2000",
    "טקסי 10",
    "365 סוכנות ביטוח",
    "3M ישראל",
    // שמות קצרים
    "יס",
    "פז",
    "עמל",
    "Max",
    "hot",
    // עברית מלאה עם בע"מ וגרשיים
    'א.א. שירותי ניקיון בע"מ',
    'חברת החשמל לישראל בע"מ',
    "עיריית תל אביב-יפו",
    'החברה הישראלית לביטוח סיכוני סחר חוץ בע"מ',
    "ד\"ר לוי שירותי רפואה",
    // רגרסיה: שמות שמכילים רצפים שנחסמו בעבר כ-substring
    "Data Supplier Ltd",
    "Extraction Services Ltd",
    "Example Industries",
    // אנגלית עם CamelCase לגיטימי
    "PayPal",
    "iCount",
    "GoDaddy",
  ] as const;

  for (const name of valid) {
    assert.equal(isLikelyJunkSupplierName(name), false, `expected valid: ${name}`);
  }
});

test("looksLikeSentenceFragmentName: sentences yes, long legit company names no", () => {
  assert.equal(looksLikeSentenceFragmentName("צוות התמיכה שלנו בנושא החשבונית שלך"), true);
  assert.equal(looksLikeSentenceFragmentName("please see attached your invoice"), true);
  assert.equal(looksLikeSentenceFragmentName('החברה הישראלית לביטוח סיכוני סחר חוץ בע"מ'), false);
  assert.equal(looksLikeSentenceFragmentName("פיצה 2000"), false);
});

test("generic sender tokens are blocked as standalone names but not inside longer names (F2)", () => {
  for (const token of ["Info", "Team", "noreply", "Do-Not-Reply", "צוות", "מערכת", "שירות לקוחות"]) {
    assert.equal(isUsableSupplierNameShared(token), false, `expected blocked: ${token}`);
  }
  // שמות עסק שמכילים את המילים כחלק משם ארוך יותר — חייבים לעבור
  for (const name of ['שירות מוניציפלי בע"מ', "מערכות מידע מתקדמות", "Team Sport Ltd", "Info-Tech Israel"]) {
    assert.equal(isUsableSupplierNameShared(name), true, `expected usable: ${name}`);
  }
  assert.equal(GENERIC_SENDER_TOKENS.has("info"), true);
});

test("isValidSupplierNameShared blocks junk (WhatsApp path regression, F1)", () => {
  // לפני התיקון המסלול של WhatsApp לא בדק זבל בכלל
  for (const junk of ['"supplier": "x"', "rawOcrText", "לא זוהה", "supplier name", "info@acme.co.il", "acme.co.il"]) {
    assert.equal(isValidSupplierNameShared(junk), false, `expected invalid: ${junk}`);
  }
  for (const valid of ["פיצה 2000", 'א.א. שירותי ניקיון בע"מ', "Wolt", "יס"]) {
    assert.equal(isValidSupplierNameShared(valid), true, `expected valid: ${valid}`);
  }
});
