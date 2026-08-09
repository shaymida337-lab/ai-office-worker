const FRONT = "https://ai-office-worker-frontend.onrender.com";
const text = await fetch(`${FRONT}/_next/static/chunks/layout-8f26b27d5b7d0517.js`).then((r) => r.text());
const idx = text.indexOf("אשר והשלם");
console.log(JSON.stringify({
  layoutBytes: text.length,
  idx,
  context: idx >= 0 ? text.slice(idx - 150, idx + 250) : null,
  isHelpContext: idx >= 0 && text.slice(idx - 300, idx + 300).includes("explanation"),
}, null, 2));
