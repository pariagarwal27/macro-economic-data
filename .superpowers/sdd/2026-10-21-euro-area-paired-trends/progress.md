# SDD ledger — plan: docs/superpowers/plans/2026-10-21-euro-area-paired-trends.md

Ruling: Continue in the current authorized workspace instead of creating a fresh Git worktree — this checkout contains the user's existing local dashboard changes that the feature depends on, and a fresh worktree would omit them; `.git` is read-only here — cost if wrong: the work remains alongside existing uncommitted changes, so the targeted diff needs careful review.

Pre-flight: Tasks 1, 2, and 3 share the `OverviewChartPoint` trend-key contract (`${region}Trend`) and the paired tooltip component; each keeps its own calculation/data series and consumes that shared presentation contract. No interface conflict found.

Task 1: complete — Euro Area HICP headline/core use the trailing mean of three consecutive published YoY values; added dotted lines and precise legend labels.

Task 2: complete — Euro Area retail uses a four-point monthly sequence of original Eurostat SCA volume-index levels for 3m/3m SAAR; missing/non-positive index levels remain gaps.

Task 3: complete — Euro Area wage QoQ series uses official quarterly observations only; chart legend, tooltip heading, and chart note identify the measure. Existing unemployment rate plus three-month average remains in place.

Task 4: ESLint passed for all three changed TypeScript files; `git diff --check` passed with only Git line-ending notices. `npx tsc --noEmit` reports three existing errors in the unrelated untracked `scripts/audit-release-calendar.ts`; no errors remain in the changed files. `npm run build` could not start because SWC was denied canonicalizing the workspace path (`Access is denied`, Windows sandbox). No app code was emitted by that failed build.

Follow-up: fixed the country-page gap discovered in user screenshots. The dashboard API previously generated three-month histories only for US/UK, while the country chart controls also hid the Euro Area trends. The API now builds EA HICP three-observation averages, retail SAAR from Eurostat index raw values, monthly labour averages and official quarterly wage QoQ series; Euro Area paired chart paths and labels are enabled. ESLint passed (existing warnings only); `tsc --noEmit` remains blocked only by the three unrelated `scripts/audit-release-calendar.ts` errors. Browser runtime data/rendering has not been visually checked.
