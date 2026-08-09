const FRONT = "https://ai-office-worker-frontend.onrender.com";
const html = await fetch(`${FRONT}/reports`).then((r) => r.text());
const scripts = [...html.matchAll(/src="([^"]+)"/g)].map((m) => m[1]).filter((u) => u.includes("_next"));
const report = [];
for (const rel of scripts) {
  const url = rel.startsWith("http") ? rel : FRONT + rel;
  const text = await fetch(url).then((r) => r.text());
  const hits = ["אשר והשלם", "השלם ואשר", "ערוך ספק", "השלם פרטים", "חסום"].filter((s) => text.includes(s));
  if (hits.length) report.push({ chunk: rel.split("/").pop(), bytes: text.length, hits });
}
console.log(JSON.stringify({ scriptCount: scripts.length, chunksWithHebrew: report }, null, 2));
