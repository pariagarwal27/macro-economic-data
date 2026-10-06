async function check(id, dataset) {
  const uri = `/economy/inflationandpriceindices/timeseries/${id}/${dataset}`;
  const r = await fetch(
    "https://www.ons.gov.uk/generator?format=csv&uri=" + encodeURIComponent(uri),
    { headers: { "User-Agent": "macro-economy-tracker/1.0" } }
  );
  const t = await r.text();
  if (!r.ok || t.includes("<!DOCTYPE")) {
    console.log(r.status, id, "FAIL");
    return;
  }
  const title = (t.match(/"Title","([^"]+)"/) || [])[1];
  const last = t
    .split(/\n/)
    .filter((l) => /^"?20/.test(l))
    .slice(-2);
  console.log("OK", id, title?.slice(0, 75), "->", last.join(" | "));
}

const ids = [
  ["jvz7", "ppi"],
  ["ghip", "ppi"],
  ["d7g7", "mm23"],
  ["d7dt", "mm23"],
  ["core", "mm23"],
  ["l55o", "mm23"],
  ["czbh", "mm23"],
];

for (const [id, ds] of ids) {
  await check(id, ds);
  await new Promise((r) => setTimeout(r, 800));
}
