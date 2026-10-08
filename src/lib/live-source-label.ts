const SOURCE_LABELS: Record<string, string> = {
  adp: "ADP",
  atlanta: "Atlanta Fed",
  atlanta_gdpnow: "Atlanta Fed GDPNow",
  bea: "BEA",
  bls: "BLS",
  boe: "Bank of England",
  census: "Census Bureau",
  cleveland_sofie: "Cleveland Fed",
  dol: "DOL",
  ecb: "ECB",
  eurostat: "Eurostat",
  fred: "FRED",
  "fred-fallback": "FRED fallback",
  lseg: "LSEG",
  nyfed: "NY Fed",
  ons: "ONS",
  philadelphia: "Philadelphia Fed",
  pmi_scrape: "PMI release source",
  umich: "University of Michigan",
};

export function formatLiveSourceLabel(source: string | null | undefined): string {
  if (!source?.trim()) return "Not configured";
  const key = source.trim().toLowerCase();
  return SOURCE_LABELS[key] ?? source.trim().toUpperCase();
}
