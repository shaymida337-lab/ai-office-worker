import { classifyOcrSupplierText, detectSupplierKeyword } from "./src/services/gmail-sync.ts";

const text = [
  'אגורות 10-ו yellow בחנויות 10% צוברים מועדון חברי',
  '.לארנק ₪ 5.57 לצבור יכולת זו בקניה !בפז בתדלוק',
  'החשבונית להורדת',
  '1310',
  'החדשה מודיעין',
  'שלך החשבון סיכום',
  '₪ 418.39',
  '95 בנע',
  'הנחה לפני כ"סה ₪ 418.39',
  'ישראכרט - ויזה',
  '05361***********',
  '₪ 418.39',
  'רכב מספר 1408871',
  'מ"מע ללא סכום ₪ 357.60',
  'מ"מע ₪ 60.79',
  'הנחות לאחר לתשלום סכום ₪ 418.39',
  'חשבונית מספר 026309901407453',
  'תאריך 20:50 2024-03-05',
].join("\n");

const classify = classifyOcrSupplierText(text);
const detect = detectSupplierKeyword(text);

// What would פז match if isracard rule were skipped?
const withoutIsracard = text.replace(/ישראכרט/g, "XXXX");
const classifyWithoutCard = classifyOcrSupplierText(withoutIsracard);

console.log(JSON.stringify({
  classify,
  detect,
  classifyWithoutCardBrand: classifyWithoutCard,
  hasYellow: /yellow/i.test(text),
  hasPaz: /בפז|פז/.test(text),
  hasIsracard: /ישראכרט/.test(text),
}, null, 2));
