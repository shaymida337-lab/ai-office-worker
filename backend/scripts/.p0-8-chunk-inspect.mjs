const FRONT = "https://ai-office-worker-frontend.onrender.com";
const chunks = [
  "/_next/static/chunks/app/reports/page-9ba96bab0a7cd726.js",
  "/_next/static/chunks/layout-8f26b27d5b7d0517.js",
  "/_next/static/chunks/3043-e98d28fa03d94897.js",
];
const needles = ["אשר והשלם", "השלם ואשר", "ערוך ספק", "השלם פרטים", "חסום", "canApproveDirectly"];

for (const c of chunks) {
  const text = await fetch(FRONT + c).then((r) => r.text());
  console.log("\nCHUNK:", c.split("/").pop(), "bytes:", text.length);
  for (const n of needles) {
    const idx = text.indexOf(n);
    console.log(`  ${n}: ${idx >= 0 ? "FOUND@" + idx : "absent"}`);
    if (n === "אשר והשלם" && idx >= 0) {
      console.log("  context:", JSON.stringify(text.slice(Math.max(0, idx - 100), idx + 150)));
    }
  }
  const oldPattern = text.includes("אשר והשלם") && text.includes("needs_review");
  console.log("  old-pattern (אשר והשלם + needs_review in same chunk):", oldPattern);
}
