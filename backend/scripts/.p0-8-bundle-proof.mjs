const FRONT = "https://ai-office-worker-frontend.onrender.com";
const html = await fetch(`${FRONT}/reports`).then((r) => r.text());
const layoutSrc = [...html.matchAll(/src="([^"]+)"/g)].map((m) => m[1]).find((u) => u.includes("layout-"));
const reportsSrc = [...html.matchAll(/src="([^"]+)"/g)].map((m) => m[1]).find((u) => u.includes("app/reports/page-"));
const layoutUrl = layoutSrc.startsWith("http") ? layoutSrc : FRONT + layoutSrc;
const reportsUrl = reportsSrc.startsWith("http") ? reportsSrc : FRONT + reportsSrc;
const layout = await fetch(layoutUrl).then((r) => r.text());
const reports = await fetch(reportsUrl).then((r) => r.text());
const idx = layout.indexOf("אשר והשלם");
console.log(
  JSON.stringify(
    {
      layoutUrl,
      reportsUrl,
      layoutBytes: layout.length,
      reportsBytes: reports.length,
      layoutHasAsherVeHashlem: idx >= 0,
      layoutContext: idx >= 0 ? layout.slice(idx - 80, idx + 120) : null,
      reportsLabels: {
        asherVeHashlem: reports.includes("אשר והשלם"),
        hashlemVeAsher: reports.includes("השלם ואשר"),
        asher: reports.includes('"אשר"') || reports.includes("אשר"),
        editSupplier: reports.includes("ערוך ספק"),
        completeDetails: reports.includes("השלם פרטים"),
        blocked: reports.includes("חסום"),
      },
    },
    null,
    2,
  ),
);
