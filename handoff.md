# Macro Economy Tracker — Handoff Document

**Project path:** `/Users/maverick/projects/macro_economic_data`  
**Stack:** Next.js 15 · React 19 · SQLite (LibSQL) · TypeScript  
**Default dev URL:** `http://localhost:3000` (may run on `:3010` if port busy)  
**Last updated:** September 2026

---

## 1. What this project is

A **fast, local-first macro dashboard** covering **US, UK, and Euro Area** across three pillars:

- **Inflation** — CPI/HICP, core, PPI, trimmed means, expectations (consumer, professional, market)
- **Growth** — GDP, industrial production, retail sales, PMI proxies, GDPNow
- **Jobs** — NFP/payrolls, unemployment, JOLTS, claims, wages/ECI/AWE, vacancies

Goals:

1. **Catalogue** 130+ official series with metadata, links, and importance tiers
2. **Backfill** deep history from FRED, ONS, Eurostat, ECB, BoE
3. **Refresh** on release day from live agency sources (BLS API, ADP, DOL, etc.) — not FRED lag
4. **Display** latest vs prior, consensus, surprise, forward calendar, and cross-economy desk matrices
5. **Ingest Investing.com** calendar dumps for consensus/actual on market-moving releases

---

## 2. Architecture overview

```
┌─────────────────────────────────────────────────────────────────┐
│  UI (Next.js)                                                   │
│  /  Dashboard    /desk  Matrix    /calendar  Forward tape       │
│  /metrics/[id]  Detail + chart                                    │
└───────────────────────────┬─────────────────────────────────────┘
                            │ API routes
┌───────────────────────────▼─────────────────────────────────────┐
│  pipeline.ts — orchestration, queries, schema                     │
│  catalog/ — metrics.ts, desk-matrix.ts, desk-smoothed.ts,       │
│             investing-map.ts, live-map.ts                         │
└───────────────────────────┬─────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
   ingest/*.ts         data/macro.db      data/investing/*.json
   (FRED,BLS,ONS,     SQLite WAL          Investing calendar dumps
    Eurostat,ECB,BoE)
```

### Key directories

| Path | Purpose |
|------|---------|
| `src/catalog/metrics.ts` | 134-metric universe (IDs, sources, transforms, URLs) |
| `src/catalog/desk-matrix.ts` | Cross-economy monthly comparison row definitions |
| `src/catalog/desk-smoothed.ts` | 3m smoothed / annualized row definitions |
| `src/catalog/investing-map.ts` | 94 event-name → metric ID mapping rules |
| `src/catalog/live-map.ts` | Release-day live source routing |
| `src/ingest/pipeline.ts` | Schema, ingest, dashboard queries, matrix builders |
| `src/ingest/*.ts` | Per-source fetchers |
| `src/db/schema.ts` | Drizzle ORM definitions |
| `scripts/ingest.ts` | CLI backfill/refresh |
| `scripts/capture-investing-month.ts` | Investing.com browser capture |
| `scripts/import-investing-calendar.ts` | Dump → DB import |
| `data/macro.db` | SQLite database (~20 MB) |
| `data/investing/` | Month JSON dumps + surprise audit reports |

---

## 3. Database schema

| Table | Rows (approx) | Purpose |
|-------|---------------|---------|
| `metrics` | 134 | Catalog metadata |
| `observations` | 85,000+ | Time series (`metric_id`, `date`, `value`, `raw_value`) |
| `releases` | 1,400+ | Release events with actual/expected/prior |
| `calendar_events` | 14,000+ | Raw Investing calendar rows |
| `ingest_runs` | — | Audit log per backfill/refresh |
| `source_handles` | 23 | X/Twitter handles for release signals |

**`raw_value`** stores the underlying index level when the displayed `value` is a transform (YoY, MoM). Critical for wage 3m/3m annualization on US AHE.

---

## 4. Data sources by region

### United States (69 metrics)

| Source | Module | Series examples |
|--------|--------|-----------------|
| **FRED** | `fred.ts` | Historical backfill for 74 FRED series |
| **BLS API** | `bls.ts` | CPI, NFP, unemployment, PPI, JOLTS, ECI, AHE (release-day) |
| **BLS HTML** | `bls-releases.ts` | Fallback when API empty |
| **BEA** | `bea.ts` | GDP, PCE (`BEA_API_KEY` required) |
| **ADP** | `adp.ts` | Private payrolls JSON scrape |
| **DOL** | `dol-claims.ts` | Weekly initial/continuing claims (PDF/HTML) |
| **Atlanta Fed** | `fed-regional.ts` | GDPNow |
| **Cleveland Fed** | FRED + `fed-regional.ts` | Inflation expectations, median CPI |

### United Kingdom (32 metrics)

| Source | Module | Series examples |
|--------|--------|-----------------|
| **ONS CSV** | `ons.ts` | CPI, core, GDP, AWE, vacancies, IP, retail (28 series) |
| **ONS PPI bulletin** | `ons-ppi-bulletin.ts` | Release-day PPI when timeseries lags |
| **BoE IAS** | `boe-inflation-attitudes.ts` | Consumer inflation expectations 1Y/2Y/5Y (sitemap scrape) |

### Euro Area (33 metrics)

| Source | Module | Series examples |
|--------|--------|-----------------|
| **Eurostat JSON** | `eurostat.ts` | HICP, GDP, unemployment, IP, retail, employment (25 series) |
| **ECB SPF** | `ecb-spf.ts` | Professional forecaster HICP/core/LT, wage assumptions |
| **ECB CES** | `ecb-spf.ts` | Monthly consumer inflation expectations |

### Refresh priority

On `npm run refresh`, live sources are tried first; FRED is **fallback only** (lags hours to a day).

---

## 5. UI pages

| Route | Component | Description |
|-------|-----------|-------------|
| `/` | `Dashboard.tsx` | Metric cards by region/category, search, refresh |
| `/desk` | `DeskMatrix.tsx` | 12-month US/UK/EA matrix — **Monthly** and **3m Smoothed** tabs |
| `/calendar` | `ReleaseCalendar.tsx` | 7-day forward release tape, table/matrix views |
| `/metrics/[id]` | `MetricDetail.tsx` | Chart, release history, consensus/surprise |

### API routes

| Endpoint | Purpose |
|----------|---------|
| `GET /api/metrics` | Dashboard cards |
| `GET /api/metrics/[id]` | Series + releases |
| `GET /api/desk-matrix?months=12` | Monthly comparison matrix |
| `GET /api/desk-smoothed?months=12` | 3m smoothed matrix |
| `GET /api/calendar?days=7` | Forward release tape |
| `GET /api/refresh?secret=...` | Cron ingest trigger |

---

## 6. Desk matrix (`/desk`)

### Monthly prints tab

Three blocks — **Inflation**, **Growth**, **Employment** — with US/UK/EA stacked rows and 12 monthly columns.

**Cell format:** actual (bold) on top, consensus (smaller) below when available from Investing.

**Column rules:**
- `monthly` — all 12 months
- `quarter` — Mar/Jun/Sep/Dec only (GDP, EA payrolls)
- `survey` — Feb/May/Aug/Nov only (BoE IAS, ECB SPF)

**Key rows added in recent work:**
- Core CPI MoM (US/UK/EA)
- Retail sales MoM (all three — ONS J5EC, Eurostat `ei_isrr_mom`)
- Expectations block: UMich / BoE IAS / ECB CES (consumer); Cleveland / SPF (professional); SPF core/LT; wage row
- UK employment change (ONS MGRZ diff), EA employment (Eurostat `lfsi_emp_q`)

### 3m Smoothed tab (new)

Seven major indicators × 3 economies. Formulas in `src/lib/smoothing.ts`:

| Row | US | UK | EA | Method |
|-----|----|----|-----|--------|
| CPI 3m/3m ann. | `us-cpi-mom` | `uk-cpi-mom` | `ea-hicp-mom` | Compound 3 MoM → annualize |
| Core CPI 3m/3m ann. | core MoM series | core MoM series | core MoM series | Same |
| Unemployment 3m avg | `us-unemployment` | `uk-unemployment` | `ea-unemployment` | Arithmetic mean of last 3 |
| Employment change 3m avg | `us-nfp` | `uk-employment-change` | `ea-employment-change` | 3m avg (EA quarterly cols) |
| Wage growth | `us-ahe-mom` MoM → 3m ann | `uk-awe-regular-mom` (KAI7) → 3m ann | `ea-wage-growth-qoq` QoQ → 3q ann (×4/3) |
| Retail sales 3m/3m ann. | `us-retail-sales` | `uk-retail-sales-mom` | `ea-retail-sales-mom` | Compound 3 MoM |
| Industrial production 3m/3m ann. | IP YoY index | IP YoY index | IP YoY index | Index t/t−3 annualized |

\*UK and EA wage rows compound period-on-period % prints (MoM / QoQ) then annualize — same formula as CPI, with EA using quarterly QoQ and exponent 4/3.

**Display rule (important):** A smoothed value appears in column **T** only when the anchor print for month **T** has been released, and all required lags exist. Unreleased months are **blank** — never forward-filled from the prior month.

**Formulas:**

```
3m/3m ann. from MoM (column T):  uses MoM prints at T−2, T−1, T
  ann = ( Π(1 + m_i/100) )^4 − 1

3m/3m ann. from index (column T):  index levels at T−3 … T
  ann = ( level_T / level_{T−3} )^4 − 1

3m average (column T):             mean of prints at T−2, T−1, T
```

**Example — US CPI 3m/3m ann. for Jul 2026 column:**
- MoM: May +0.47%, Jun −0.42%, Jul +0.07%
- Compound: (1.0047)(0.9958)(1.0007) ≈ 1.00125
- Annualize: 1.00125⁴ − 1 ≈ **+0.49%** → shown in Jul column only
- Aug/Sep columns blank until those CPI prints release

---

## 7. Investing.com pipeline

### What it does

Investing.com provides **consensus, actual, and prior** for market-moving releases. We capture via browser (Cloudflare-protected), store raw JSON, map events to catalog metrics, and promote to `releases` + `calendar_events`.

### Capture flow (production method)

```
scripts/capture-investing-month.ts
  → scripts/investing-browser-session.ts  (real Chrome, persistent profile)
  → scripts/investing-browser-capture.ts    (injected JS: date picker, Load more, DOM scrape)
  → data/investing/YYYY-MM.json
```

**Usage:**
```bash
npm run capture:investing -- 2026-09-04 2026-09-10 2026-09
npm run import:investing
```

**Profile:** `.playwright-investing-profile/` (gitignored) — holds Cloudflare cookies.

**Countries captured:** US, UK, EA, DE, FR, IT, ES, AU

### Import flow

```
scripts/import-investing-calendar.ts
  → src/ingest/investing-calendar.ts
      1. Zod validate JSON
      2. Parse BST/GMT/CET → UTC
      3. mapInvestingEvent() via investing-map.ts (94 rules)
      4. Upsert calendar_events
      5. Promote to releases (with INVESTING_TO_CATALOG_SCALE)
```

**Scale examples:** NFP Investing reports in thousands → catalog stores diff in thousands → scale `0.001` applied on import for some series.

### What worked ✅

| Area | Result |
|------|--------|
| DOM capture Jul 2025 → Aug 2026 | 18 month dumps, ~200 KB each |
| Cloudflare bypass | Works with **headed real Chrome**, persistent profile, 2.5–5s human pauses, up to 15 min CF wait |
| Forward gap capture (Sep 4–10) | `2026-09.json` merged successfully (321 rows) |
| Import → calendar_events | 14,319 rows |
| Consensus on desk matrix | Shows for CPI, NFP, GDP, etc. where mapped |
| Remap script | `npm run remap:investing` rebuilds releases after rule changes |
| Surprise audit | `npm run audit:surprise` — read-only QA vs official obs |

### What did NOT work / fragile ⚠️

| Issue | Detail |
|-------|--------|
| **Cloudflare** | Fragile — requires manual checkbox on fresh profile; Playwright Chromium alone fails |
| **Headless capture** | Not reliable — must use headed Chrome |
| **API fetch method** | `scripts/fetch-investing-api.ts` exists but experimental; not in package.json scripts |
| **ADP surprise alignment** | 0% match — scale/units mismatch (`us-adp-change`) |
| **US CPI MoM mapping** | 32% match — title ambiguity (MoM vs index) |
| **EA HICP YoY** | 67% match — needs review |
| **Forward calendar gaps** | UI warns when dumps don't cover full 7-day window |
| **Survey series consensus** | BoE/ECB surveys have no Investing consensus |
| **UK payrolls consensus** | No Investing mapping; ONS doesn't publish consensus |
| **Surprise UI** | Audit exists but not wired to dashboard cards yet |

### Investing map highlights

- 94 regex rules in `investing-map.ts`
- Rejects regional German CPI from national `de-cpi-yoy`
- GDP requires QoQ/annualized in title
- UK CPI requires YoY in title (not index)

---

## 8. Official-source ingest — what worked / didn't

### Worked ✅

| Source | Notes |
|--------|-------|
| FRED backfill | 74 series, deep history |
| BLS API | 23 series on refresh; fast release-day |
| ONS CSV | 28 UK series; 2s delay + retry for rate limits |
| Eurostat | 25 EA series; fixed `2025-Q3` quarterly parse bug |
| ECB SPF + CES | API CSV; publication-date remap (13-month lag for P12M) |
| BoE IAS scrape | 46 observations each for 1Y/2Y/5Y; fixed Q2b/Q2c regex |
| ADP JSON | Live private payrolls |
| Atlanta GDPNow | HTML scrape |

### Didn't work / intermittent ⚠️

| Source | Issue |
|--------|-------|
| **DOL claims** | PDF parse fails ("no week ending date"); HTML is form-only page |
| **BEA** | Skipped without `BEA_API_KEY` |
| **BLS HTML fallback** | Works but slower than API |
| **ONS PPI GB7S** | Timeseries can lag; bulletin scrape used on release day |
| **FRED on refresh** | Intentionally deprioritized — lags official |

---

## 9. Bugs fixed during development

| Bug | Fix |
|-----|-----|
| ECB SPF dates forward-dated | 13-month publication lag in `ecb-spf.ts` |
| BoE 5Y expectations empty | Q2c uses "median answer of X%" not "were X%" |
| Desk matrix survey rows blank | Quarterly metrics were remapped to quarter-end for all rows; now only when `columnRule === "quarter"` |
| Eurostat quarterly `2025-Q3` parse | Regex fix in `eurostat.ts` |
| EA employment wrong series | Use `lfsi_emp_q` with `EMP_LFS` |
| BoE sitemap URLs | Absolute URLs in regex |
| UK wage smoothed 12% spike | UK KAI9 is already 3m YoY % — use `ma3` not `ann3m_index` |

---

## 10. Scripts reference

```bash
npm install
cp .env.example .env.local   # optional: FRED_API_KEY, BEA_API_KEY, CRON_SECRET

npm run backfill              # Full historical ingest (all metrics)
npm run refresh               # Incremental live refresh
npm run dev                   # Dashboard on :3000

# Targeted backfill
npx tsx scripts/ingest.ts backfill uk-inflation-exp-1y,ea-ces-inflation-exp-1y

# Investing
npm run capture:investing -- 2026-09-01 2026-09-30 2026-09
npm run import:investing
npm run remap:investing
npm run audit:surprise

# DB
npm run db:push               # Ensure schema + seed catalog
```

### Environment variables

| Variable | Purpose |
|----------|---------|
| `FRED_API_KEY` | FRED API (optional but faster backfill) |
| `BEA_API_KEY` | BEA NIPA live GDP/PCE |
| `CRON_SECRET` | Protects `/api/refresh` |
| `INVESTING_CDP_URL` | Optional CDP attach for Investing capture |

---

## 11. Known limitations (honest)

1. **US GDP** is QoQ SAAR; UK/EA GDP is QoQ % — not directly comparable without footnote
2. **US wage expectations row** shows realized AHE, not NY Fed SCE forward expectations
3. **UK professional expectations** reuses BoE consumer 1Y (no separate UK SPF)
4. **Survey rows** sparse by design (3–4 cells/year vs 10–12 monthly)
5. **EA employment/wages** quarterly — fewer matrix cells
6. **Investing Cloudflare** requires babysitting on profile expiry
7. **DOL claims** ingest broken pending PDF/HTML fix
8. **No automated Investing capture** — manual monthly/gap runs

---

## 12. Future work / improvements

### High priority

- [ ] **NY Fed SCE ingest** — US consumer + wage expectations for expectations block
- [ ] **BoE Decision Maker Panel** — business wage/output price expectations (`decisionmakerpanel.co.uk`)
- [ ] **Wire surprise audit to UI** — show alignment badges on metric cards
- [ ] **Fix DOL claims** ingest (PDF week-ending parser)
- [ ] **Investing ADP scale** — resolve `us-adp-change` 0% audit match
- [ ] **Automated Investing capture** — cron with headed Chrome or CDP on MacMini
- [ ] **GDP comparability footnote** in desk matrix UI

### Medium priority

- [ ] **ECB business expectations** — add `ea-esi` or similar to matrix
- [ ] **UK wage index series** — done via KAI7 MoM for smoothed desk row
- [ ] **Consensus for new metrics** — extend investing-map for UK payrolls if Investing has them
- [ ] **API fetch Investing** — stabilize as headless alternative
- [ ] **Export desk matrix** — CSV/Excel download
- [ ] **Mobile-responsive desk** — sticky column already works; test narrow screens

### Low priority / nice-to-have

- [ ] PMI rows on desk matrix (ISM, S&P Global)
- [ ] Germany/France national CPI sub-rows
- [ ] Vintage/revision tracking in observations
- [ ] Telegram alerts on surprise (reuse workspace Telegraph standard)
- [ ] Playwright profile lock self-healing in cron

---

## 13. Metric catalog summary

| Dimension | Count |
|-----------|-------|
| Total metrics | 134 |
| US / UK / EA | 69 / 32 / 33 |
| Inflation / Growth / Jobs | 73 / 31 / 30 |
| Sources | FRED 74 · ONS 28 · Eurostat 25 · ECB 5 · BoE 2 |
| Critical importance | 50 |

Desk matrix uses **40 unique metric IDs**. Smoothed table uses **18 unique metric IDs**.

---

## 14. File map for new developers

```
Start here:
  README.md
  handoff.md          ← this file
  src/catalog/metrics.ts
  src/ingest/pipeline.ts

Desk matrix:
  src/catalog/desk-matrix.ts
  src/catalog/desk-smoothed.ts
  src/lib/smoothing.ts
  src/components/DeskMatrix.tsx

Investing:
  scripts/capture-investing-month.ts
  scripts/investing-browser-session.ts
  src/catalog/investing-map.ts
  src/ingest/investing-calendar.ts

Expectations ingest:
  src/ingest/ecb-spf.ts
  src/ingest/boe-inflation-attitudes.ts

UK/EA official:
  src/ingest/ons.ts
  src/ingest/eurostat.ts
```

---

## 15. Quick verification checklist

After any ingest or code change:

```bash
# 1. Backfill changed metrics
npx tsx scripts/ingest.ts backfill <metric-ids>

# 2. Check observations
sqlite3 data/macro.db "SELECT metric_id, COUNT(*), MAX(date) FROM observations WHERE metric_id IN ('...') GROUP BY 1;"

# 3. Hit APIs
curl -s localhost:3000/api/desk-matrix | jq '.meta'
curl -s localhost:3000/api/desk-smoothed | jq '.meta'
curl -s localhost:3000/api/calendar?days=7 | jq 'length'

# 4. Open UI
open http://localhost:3000/desk
```

---

## 16. Contact / context

Built as a **desk-grade macro comparison tool** for US/UK/EA with official-source priority and Investing.com consensus overlay. The desk matrix is the primary cross-economy view; the smoothed tab adds noise-reduced 3m trends for the seven headline indicators traders watch most.

For workspace-wide standards (PDF parsing, Playwright stealth, Gmail, Dropbox), see `/Users/maverick/projects/CLAUDE.md`.
