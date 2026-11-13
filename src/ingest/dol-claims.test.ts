import assert from "node:assert/strict";
import test from "node:test";
import { fetchDolClaims, prepareDolClaimsParser } from "./dol-claims";
import { withFreshReleaseFetch } from "./release-fetch-context.js";

// A real, minimal PDF exercises the production parser without network access.
function claimsPdf(value: number) {
  const lines = [
    `In the week ending November 7, 2026, the advance figure for seasonally adjusted initial claims was ${value}.`,
    "The advance seasonally adjusted insured unemployment rate was 1.2 percent.",
    "The advance number for seasonally adjusted insured unemployment during the week ending October 31, 2026 was 1697000.",
    "Seasonally Adjusted US Weekly UI Claims (in thousands)",
    ...Array.from({ length: 10 }, (_, i) => `October ${i + 1}, 2026 200 1 201.00 1697 1 1700.00 1.2`),
  ];
  const stream = `BT /F1 8 Tf 10 780 Td 12 TL ${lines.map(line => `(${line.replace(/[()\\]/g, "\\$&")}) Tj T*`).join("\n")} ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1000 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

test("claims preparation warms the PDF engine without requesting unreleased data", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("preparation must not contact the source"); };
  try {
    const parser = await prepareDolClaimsParser();
    assert.equal(typeof parser.PDFParse, "function");
  } finally { globalThis.fetch = original; }
});

test("simultaneous release metrics share a PDF and subsequent retries fetch a new publication", async () => {
  const original = globalThis.fetch;
  let requests = 0;
  const options: RequestInit[] = [];
  globalThis.fetch = async (_url, init) => {
    requests++;
    options.push(init ?? {});
    return new Response(claimsPdf(requests === 1 ? 200_000 : 201_000));
  };
  try {
    const [initial, continuing] = await Promise.all([
      withFreshReleaseFetch(() => fetchDolClaims()),
      withFreshReleaseFetch(() => fetchDolClaims()),
    ]);
    assert.equal(initial.initial.at(-1)?.value, 200_000);
    assert.equal(continuing.continuing.at(-1)?.value, 1_697_000);
    assert.equal(initial.initialAverage.length, 10);
    assert.equal(requests, 1, "one official document per concurrent release, not one per metric");
    const next = await withFreshReleaseFetch(() => fetchDolClaims());
    assert.equal(next.initial.at(-1)?.value, 201_000, "completed snapshots must never satisfy a retry");
    assert.equal(requests, 2);
    assert.equal(options[0].cache, "no-store");
    assert.equal(new Headers(options[0].headers).get("Cache-Control"), "no-cache");
  } finally { globalThis.fetch = original; }
});

test("an unfinished background download cannot supply a release-time fetch", async () => {
  const original = globalThis.fetch;
  let unblock!: () => void;
  const gate = new Promise<void>(resolve => { unblock = resolve; });
  let requests = 0;
  globalThis.fetch = async () => {
    const request = ++requests;
    if (request === 1) await gate;
    return new Response(claimsPdf(request === 1 ? 199_000 : 200_000));
  };
  try {
    const background = fetchDolClaims();
    // Allow the parser module imports to finish before starting the release.
    await new Promise(resolve => setImmediate(resolve));
    const release = withFreshReleaseFetch(() => fetchDolClaims());
    unblock();
    const [old, fresh] = await Promise.all([background, release]);
    assert.equal(old.initial.at(-1)?.value, 199_000);
    assert.equal(fresh.initial.at(-1)?.value, 200_000);
    assert.equal(requests, 2);
  } finally { unblock(); globalThis.fetch = original; }
});

test("a failed shared download is cleared so the next release retry can recover", async () => {
  const original = globalThis.fetch;
  const originalWarn = console.warn;
  let healthy = false;
  globalThis.fetch = async () => {
    if (!healthy) throw new Error("source temporarily unavailable");
    return new Response(claimsPdf(200_000));
  };
  console.warn = () => {};
  try {
    const failed = await Promise.allSettled([
      withFreshReleaseFetch(() => fetchDolClaims()),
      withFreshReleaseFetch(() => fetchDolClaims()),
    ]);
    assert.ok(failed.every(result => result.status === "rejected"));
    healthy = true;
    const recovered = await withFreshReleaseFetch(() => fetchDolClaims());
    assert.equal(recovered.initial.at(-1)?.value, 200_000);
  } finally { globalThis.fetch = original; console.warn = originalWarn; }
});
