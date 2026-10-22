import assert from "node:assert/strict";
import { fetchEurostatPreset } from "../src/ingest/eurostat";

const captured: URL[] = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request) => {
  captured.push(new URL(String(input)));
  return new Response(JSON.stringify({
    id: ["geo", "coicop18", "unit", "time"],
    size: [1, 1, 1, 1],
    dimension: { time: { category: { index: { "2026-09": 0 } } } },
    value: { "0": 1.1 },
  }), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

async function main() {
  try {
    await fetchEurostatPreset("prc_hicp_minr_igd_nnrg");
    await fetchEurostatPreset("prc_hicp_mmor_igd_nnrg");
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(captured.length, 2);
  for (const [index, unit] of ["RCH_A", "RCH_M"].entries()) {
    const url = captured[index];
    assert.equal(url.pathname.split("/").at(-1), "prc_hicp_minr");
    assert.equal(url.searchParams.get("geo"), "EA");
    assert.equal(url.searchParams.get("coicop18"), "IGD_NNRG", "NEIG must use Eurostat's non-energy industrial goods aggregate, not all goods");
    assert.equal(url.searchParams.get("unit"), unit);
  }

  console.log("Euro Area NEIG annual and monthly rates map to Eurostat IGD_NNRG");
}

void main();
