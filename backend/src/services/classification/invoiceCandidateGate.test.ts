import test from "node:test";
import assert from "node:assert/strict";
import { isInvoiceCandidate } from "./invoiceCandidateGate.js";

// ============ מיילים שחייבים להיחסם (זבל אמיתי מהחקירה) ============

const JUNK_SAMPLES: Array<{ name: string; sender: string; subject: string; body?: string; files?: string[] }> = [
  { name: "GitHub PR notification", sender: "notifications@github.com", subject: "Re: [org/repo] fix: review amounts to zero (PR #142)", body: "You were requested to review this pull request." },
  { name: "GitHub PR merged", sender: "notifications@github.com", subject: "[org/repo] Merged #98: detection", body: "Merged into main." },
  { name: "GitHub issue comment", sender: "notifications@github.com", subject: "Re: [org/repo] files (Issue #55)", body: "commented on issue #55" },
  { name: "GitHub forwarded PR (non-github sender)", sender: "dev@agency.example", subject: "Fwd: Pull Request #12 needs your review", body: "Please review the pull request, force-pushed new commits." },
  { name: "Dependabot", sender: "notifications@github.com", subject: "[org/repo] Bump lodash from 4.17.20 to 4.17.21", body: "dependabot opened a pull request" },
  { name: "GitLab MR", sender: "gitlab@gitlab.com", subject: "Merge request !44 was approved", body: "merge request approved" },
  { name: "Render deploy failed", sender: "no-reply@render.com", subject: "Deploy failed for ai-office-worker", body: "Your deployment failed. View logs." },
  { name: "Vercel deploy", sender: "notifications@vercel.com", subject: "Deployment succeeded", body: "Your deployment is live." },
  { name: "Sentry alert", sender: "noreply@sentry.io", subject: "New issue: TypeError in production", body: "error rate spiked" },
  { name: "CircleCI build", sender: "builds@circleci.com", subject: "Build failed on main", body: "workflow run failed" },
  { name: "Jira ticket", sender: "jira@company.atlassian.net", subject: "OFFICE-42 assigned to you", body: "task assigned" },
  { name: "Slack notification", sender: "notification@slack.com", subject: "New message in #general", body: "You have unread messages" },
  { name: "Linear issue", sender: "notifications@linear.app", subject: "ENG-101: bug triage", body: "issue updated" },
  { name: "Figma comment", sender: "comments@figma.com", subject: "New comment on Design v2", body: "mentioned you in a comment" },
  { name: "Google Calendar invite", sender: "calendar-notification@google.com", subject: "הזמנה: פגישת צוות @ יום ג׳", body: "זימון לפגישה ביומן" },
  { name: "Password reset", sender: "support@saas.example", subject: "Reset your password", body: "Click here to reset your password." },
  { name: "Security alert", sender: "no-reply@accounts.example", subject: "Security alert: new sign-in", body: "A new sign-in was detected." },
  { name: "Zoom webinar", sender: "no-reply@zoom.us", subject: "You are invited to a Zoom meeting", body: "webinar invitation, join link" },
  { name: "Empty body no attachments", sender: "someone@random.example", subject: "hi", body: "" },
  { name: "Plain conversation", sender: "friend@gmail.com", subject: "מה קורה?", body: "בא לך לדבר מחר?" },
  { name: "Notion update", sender: "team@mail.notion.so", subject: "Page updated: Roadmap", body: "commented on the page" },
];

test(`invoice gate blocks all ${JUNK_SAMPLES.length} junk samples`, () => {
  for (const sample of JUNK_SAMPLES) {
    const verdict = isInvoiceCandidate({
      sender: sample.sender,
      subject: sample.subject,
      body: sample.body ?? "",
      attachmentFilenames: sample.files ?? [],
    });
    assert.equal(verdict.isInvoice, false, `expected BLOCK: ${sample.name} — got reasons=${verdict.reasons.join(",")}`);
    assert.ok(verdict.reasons.length > 0, `blocked sample must carry a reason: ${sample.name}`);
  }
});

// ============ חשבוניות אמיתיות שאסור לחסום (קריטי) ============

const INVOICE_SAMPLES: Array<{ name: string; sender: string; subject: string; body?: string; files?: string[] }> = [
  { name: "חשבונית עברית עם PDF", sender: "billing@supplier.co.il", subject: "חשבונית מס 1042", body: "מצורפת חשבונית מס עבור שירותי ינואר.", files: ["invoice-1042.pdf"] },
  { name: "קבלה בעברית", sender: "office@moked.co.il", subject: "קבלה על תשלום", body: "תודה על התשלום, מצורפת קבלה.", files: ["receipt.pdf"] },
  { name: "iCount noreply", sender: "noreply@icount.co.il", subject: "חשבונית מס קבלה 305", body: "מסמך חדש הופק עבורך.", files: ["doc-305.pdf"] },
  { name: "Green Invoice", sender: "no-reply@greeninvoice.co.il", subject: "התקבלה חשבונית חדשה מספק", body: "חשבונית מס 88 מצורפת.", files: ["invoice-88.pdf"] },
  { name: "GitHub payment receipt (דומיין חסום + מילת מפתח)", sender: "support@github.com", subject: "[GitHub] Payment receipt for October", body: "Your receipt for the Team plan. Amount charged: $44.00" },
  { name: "Google Workspace billing", sender: "payments-noreply@google.com", subject: "Your Google Workspace invoice is available", body: "Invoice amount: ₪57.96" },
  { name: "PDF בלי מילות מפתח בגוף", sender: "hanan@plumber.example", subject: "מסמך עבורך", body: "מצורף", files: ["scan-2026-07.pdf"] },
  { name: "צילום חשבונית (תמונה)", sender: "worker@fieldteam.example", subject: "צילום מהיום", body: "", files: ["IMG_2041.jpeg"] },
  { name: "דרישת תשלום בגוף בלי צירוף", sender: "vaad@building.example", subject: "דרישת תשלום ועד בית", body: "נא לשלם 350 ₪ עד סוף החודש." },
  { name: "חיוב חודשי", sender: "billing@cellcom.co.il", subject: "חיוב חודשי — יולי", body: "סכום לתשלום: 129.90 ₪" },
  { name: "הצעת מחיר", sender: "sales@catering.example", subject: "הצעת מחיר לאירוע", body: "מצורפת הצעת מחיר כמבוקש.", files: ["quote.pdf"] },
  { name: "amount due באנגלית", sender: "ar@overseas-vendor.com", subject: "Statement — July", body: "Total due: $1,250.00 by July 31." },
  { name: "Invoice באנגלית בנושא בלבד", sender: "accounts@saas-tool.com", subject: "Invoice #INV-2207", body: "Please find attached.", files: ["INV-2207.pdf"] },
  { name: "קבלה בשם הקובץ בלבד", sender: "auto@pos.example", subject: "מסמך חדש", body: "", files: ["קבלה-1187.pdf"] },
  { name: "מייל עם סכום בש\"ח בלי צירוף", sender: "gardener@green.example", subject: "עבודות גינון", body: "עלות העבודה 800 ש\"ח, אשמח להעברה." },
  { name: "אקסל הוצאות", sender: "bookkeeper@office.example", subject: "ריכוז הוצאות", body: "מצורף ריכוז ההוצאות לרבעון.", files: ["expenses-q2.xlsx"] },
  { name: "חשבון עסקה", sender: "supplier@parts.co.il", subject: "חשבון עסקה 771", body: "מצורף חשבון עסקה.", files: ["doc771.pdf"] },
  { name: "payment request אנגלית", sender: "vendor@abroad.example", subject: "Payment request — order 5521", body: "Kindly settle the attached payment request.", files: ["pr-5521.pdf"] },
  { name: "תלוש/מסמך שכר", sender: "payroll@office.example", subject: "תלוש יוני", body: "מצורף תלוש.", files: ["payslip-06.pdf"] },
  { name: "docx מסמך", sender: "lawyer@firm.example", subject: "מסמך התחשבנות", body: "מצורף מסמך עם פירוט הסכומים: 4,200 ₪.", files: ["settlement.docx"] },
  { name: "PayPal receipt", sender: "service@paypal.co.il", subject: "Receipt for your payment", body: "You sent a payment of $25.00." },
  { name: "WhatsApp-forward עם תמונה", sender: "me@mybusiness.example", subject: "Fwd: חשבונית מהספק", body: "מעביר אליך.", files: ["WhatsApp Image 2026-07-10.jpg"] },
  { name: "ניכיון/אשראי ספק עם מספרים", sender: "finance@distributor.co.il", subject: "זיכוי על החזרה", body: "זיכוי בסך 230 ₪ יקוזז מהחשבונית הבאה." },
  { name: "מונח קבלה בתוך נושא ארוך", sender: "clinic@health.example", subject: "קבלה מספר 2210 — טיפול מיום 3.7", body: "" },
  { name: "חשבונית בלי שום גוף וקובץ עם שם גנרי", sender: "scan@copier.example", subject: "חשבונית סרוקה", body: "", files: ["scan0001.pdf"] },
];

test(`invoice gate passes all ${INVOICE_SAMPLES.length} real invoice samples (critical: no false blocks)`, () => {
  for (const sample of INVOICE_SAMPLES) {
    const verdict = isInvoiceCandidate({
      sender: sample.sender,
      subject: sample.subject,
      body: sample.body ?? "",
      attachmentFilenames: sample.files ?? [],
    });
    assert.equal(verdict.isInvoice, true, `expected PASS: ${sample.name} — got reasons=${verdict.reasons.join(",")}`);
    assert.ok(verdict.confidence >= 0.5, `expected confidence>=0.5: ${sample.name} (${verdict.confidence})`);
  }
});

// ============ מבנה התוצאה ============

test("gate result carries confidence and reasons for logging", () => {
  const blocked = isInvoiceCandidate({ sender: "notifications@github.com", subject: "PR #1", body: "pull request" });
  assert.equal(blocked.isInvoice, false);
  assert.match(blocked.reasons[0], /never_financial_sender:github\.com/);

  const passed = isInvoiceCandidate({ sender: "a@b.co.il", subject: "חשבונית 5", body: "" });
  assert.equal(passed.isInvoice, true);
  assert.equal(passed.reasons[0], "financial_keyword_in_subject_or_filename");
});
