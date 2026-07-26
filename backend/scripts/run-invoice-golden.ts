/**
 * CLI entry for the invoice golden baseline runner.
 * Usage (from backend/): npx tsx scripts/run-invoice-golden.ts
 */
import {
  printInvoiceGoldenReport,
  runInvoiceGoldenDataset,
} from "../src/services/invoice/invoiceGoldenRunner.js";

const report = runInvoiceGoldenDataset();
printInvoiceGoldenReport(report);
if (report.results.length === 0) process.exit(1);
