import { extractDeterministicInvoiceFieldsFromPdfText } from "./src/services/invoice/pdfTextInvoiceExtraction.ts";
import { isLikelyJunkSupplierName } from "./src/services/supplierNameValidation.ts";

const text = `חשבונית מס
תאריך חשבונית: 14/06/2026
מספר מסמך: SYN-NOSUP-001
שירות כללי
₪150.00 סה״כ לתשלום`;

const extracted = extractDeterministicInvoiceFieldsFromPdfText(text);
console.log("extracted", extracted);
console.log("junk date?", isLikelyJunkSupplierName("תאריך חשבונית: 14/06/2026"));
console.log("junk service?", isLikelyJunkSupplierName("שירות כללי"));
