import json
from pathlib import Path

p=Path("special_us_macro_fetch_results.json")
d=json.loads(p.read_text(encoding="utf-8"))
rows=[x for x in d.get("metrics",[]) if x.get("metric_id") in {"us-initial-jobless-claims","us-continuing-jobless-claims"}]
if len(rows)!=2:
    raise SystemExit(f"Expected 2 DOL claims rows, found {len(rows)}")
for r in rows:
    print(r["metric_id"], r.get("next_release_date"), r.get("next_release_at"), r.get("release_status"))
print("DOL claims calendar source verification complete.")
