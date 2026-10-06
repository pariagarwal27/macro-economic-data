async function main() {
  // FRED output PPI index -> YoY
  const r = await fetch(
    "https://fred.stlouisfed.org/graph/fredgraph.csv?id=GBRPPDMMINMEI",
    { headers: { "User-Agent": "macro-economy-tracker/1.0" } }
  );
  const lines = (await r.text()).trim().split(/\n/);
  console.log("FRED out last5", lines.slice(-5));

  // Try newer ONS PPI time series dataset path
  const urls = [
    "https://www.ons.gov.uk/generator?format=csv&uri=/economy/inflationandpriceindices/timeseries/g6s7/ppi",
    "https://www.ons.gov.uk/generator?format=csv&uri=/economy/inflationandpriceindices/timeseries/rfb7/ppi",
    "https://www.ons.gov.uk/generator?format=csv&uri=/economy/inflationandpriceindices/timeseries/gb7s/mm22",
  ];
  for (const u of urls) {
    const res = await fetch(u, {
      headers: { "User-Agent": "macro-economy-tracker/1.0" },
    });
    const t = await res.text();
    console.log(res.status, u.slice(-20), t.slice(0, 120).replace(/\n/g, " | "));
  }
}

main().catch(console.error);
