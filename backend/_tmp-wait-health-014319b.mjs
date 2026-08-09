const WANT = "014319b";
const URL = "https://ai-office-worker-backend.onrender.com/health";
const started = Date.now();

async function once() {
  const res = await fetch(URL, { cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  const commit = String(body.commitSha ?? body.commit ?? body.gitCommit ?? "");
  return { status: res.status, commit: commit.slice(0, 7), keys: Object.keys(body) };
}

for (let i = 0; i < 40; i++) {
  const hit = await once();
  console.log(
    JSON.stringify({
      elapsedSec: Math.round((Date.now() - started) / 1000),
      lookingFor: WANT,
      ...hit,
    }),
  );
  if (hit.status === 200 && hit.commit && hit.commit.startsWith(WANT.slice(0, 7))) {
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 15000));
}
process.exit(2);
