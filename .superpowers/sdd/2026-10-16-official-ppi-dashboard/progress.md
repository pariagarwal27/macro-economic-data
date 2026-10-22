# SDD ledger — plan: docs/superpowers/plans/2026-10-16-official-ppi-dashboard.md

Task 1: implemented official BLS, ONS, Eurostat metric definitions and routing for headline and major groups. Verification: scripts/test-ppi-official-dashboard.mjs passes for 94 catalog metrics; live source route restricted in this environment.
Task 2: implemented Eurostat dimension routing and ONS monthly-only CSV parsing. Verification: scripts/test-ppi-provider-mappings.mjs and scripts/test-ons-ppi-monthly-frequency.mjs pass. Historical database backfill remains unrun because outbound agency requests are blocked and the local database already contains user data.
Task 3: implemented the PPI comparison view for US, UK, and EA in the existing dashboard style. TypeScript check passes; production build cannot run because the environment denies child process spawn (EPERM), so visual rendering is unverified.
Task 4: implemented BLS/ONS/Eurostat calendar mappings and paired release dispatch. Verification: official BLS schedule parser tests and release retry tests pass; Python calendar registries import and compile.

Ruling: ONS PPI components are published as unadjusted monthly indices; to satisfy the user's explicit request for MoM on every component, calculate MoM from ONS's official NSA index, label it NSA, and do not apply local seasonal adjustment. Cost if wrong: readers may interpret an unadjusted monthly rate as comparable to a seasonally adjusted one.

Final review: self-review (no subagent tool available). Deferred: export-total UK ONS PPI aggregate not added because a current official series identifier was not verified; ten-year database backfill and live API smoke tests require outbound access.
