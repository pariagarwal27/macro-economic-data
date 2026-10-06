# Cloud release refresh implementation plan

Goal: keep the deployed dashboard's D1 data refreshed without the local PC.

Use the existing dispatcher, processor, writer and official-source pipeline.
Cloudflare cron invokes a protected Next.js route through the OpenNext handler.
Use small batches, fair retries, hosted state and safety reconciliation for stale
calendar entries. Preserve local LSEG routing, select verified official mappings
in cloud execution, and explicitly report sources that need desktop/browser access.

- [x] Regression checks for D1 claims, retry cooldown, idempotent observations,
  official cloud routing, and stale-calendar safety polling.
- [x] Adapt release state to D1; prevent retry starvation and unbounded queries.
- [x] Enable the protected route and add the OpenNext scheduled wrapper.
- [x] Make latest-value source imports compatible with Workers. Keep desktop-only
  browser/PDF dependencies out of Worker startup; reuse provider transforms.
- [x] Upload existing provider keys and a generated cron secret without logging them.
- [ ] Build, publish, manually run a hosted cycle and inspect persisted state.
- [ ] Verify cron registration, observe a real scheduled cycle, and repeat site checks.
- [x] Document timing, source limitations, and verification evidence.

Published minute schedule and observed real cron invocations. Hosted execution
is blocked by the account's D1 daily read quota until 2026-10-07 00:00 UTC.
Public page/API checks pass using explicitly labelled saved snapshots. This is
not a successful ingestion-cycle verification. Representative real BLS, BEA,
ONS, Eurostat, FRED and Census source calls pass locally in cloud mode.
