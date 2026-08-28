const url = process.argv[2] ?? "http://localhost:3000/api/registry/specs";
const durationSeconds = Number(process.argv[3] ?? 60);
const concurrency = Number(process.argv[4] ?? 20);
const end = Date.now() + durationSeconds * 1000;
let requests = 0;
let responses429 = 0;
let stale = 0;

async function worker() {
  while (Date.now() < end) {
    const response = await fetch(url, { headers: { "x-api-key": `load-${Math.random()}` } });
    requests += 1;
    if (response.status === 429) responses429 += 1;
    const body = await response.json().catch(() => null);
    if (body?.servedFrom === "stale") stale += 1;
  }
}

await Promise.all(Array.from({ length: concurrency }, worker));
console.log(
  JSON.stringify(
    {
      url,
      durationSeconds,
      concurrency,
      sustainedRps: Number((requests / durationSeconds).toFixed(2)),
      requests,
      responses429,
      staleResponses: stale,
      ceilingBehavior:
        "429 with Retry-After or servedFrom: stale when the chain-read budget is exhausted",
    },
    null,
    2,
  ),
);
