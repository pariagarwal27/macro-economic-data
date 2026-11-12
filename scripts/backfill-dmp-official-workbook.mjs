import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createClient } from "@libsql/client";
import * as XLSX from "xlsx";

const workbookPath = path.resolve(process.argv[2] ?? "data/official_dmp_october_2026.xlsx");
const apply = process.argv.includes("--apply");
const releaseDate = "2026-10-30";
const vintageDate = releaseDate;
const releaseAtFallback = "2026-10-30T09:30:00.000Z";
const officialSource = "https://www.bankofengland.co.uk/decision-maker-panel/2026/october-2026";
const workbookSource = "https://www.bankofengland.co.uk/-/media/boe/files/decision-maker-panel-survey/2026/monthly-dmp-data-october-2026.xlsx";
const auditDir = path.resolve("data/audits/dmp-official-backfill-20261030");

function dateKey(value) {
  if (value instanceof Date) return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const match = String(value ?? "").trim().match(/^([A-Za-z]{3})-(\d{2})$/);
  if (!match) return null;
  const month = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" }[match[1]];
  return month ? `20${match[2]}-${month}-01` : null;
}

function num(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value == null || /^n\/?a$/i.test(String(value).trim())) return null;
  const parsed = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function rowsOf(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`Official DMP workbook is missing sheet: ${sheetName}`);
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
}

function indexedRows(rows, dateColumn, valueColumn, startRow) {
  const points = new Map();
  for (const row of rows.slice(startRow)) {
    const date = dateKey(row[dateColumn]);
    const value = num(row[valueColumn]);
    if (date && value != null) points.set(date, value);
  }
  if (!points.size) throw new Error("Official DMP workbook yielded an empty series");
  return points;
}

function previousMonth(date) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCMonth(value.getUTCMonth() - 1);
  return value.toISOString().slice(0, 7) + "-01";
}

function latestPoint(points) {
  return [...points.entries()].sort(([a], [b]) => a.localeCompare(b)).at(-1);
}

function sameValue(a, b) {
  return a != null && b != null && Math.abs(Number(a) - Number(b)) < 1e-9;
}

async function main() {
  const workbook = XLSX.read(await fs.readFile(workbookPath), { type: "buffer", cellDates: true });
  const cpi = rowsOf(workbook, "CPI expectations");
  const cpiHeaders = cpi[3] ?? [];
  const cpi1yColumn = cpiHeaders.findIndex((value, index) => index > 2 && String(value).trim().toLowerCase() === "single month");
  const cpi3yColumn = cpiHeaders.findIndex((value, index) => index > 4 && String(value).trim().toLowerCase() === "single month");
  assert.ok(cpi1yColumn >= 0 && cpi3yColumn >= 0, "CPI sheet must expose both labeled single-month horizons");

  const price = rowsOf(workbook, "Price growth");
  const priceHeaders = price[3] ?? [];
  const ownPrice3mColumn = priceHeaders.findIndex((value, index) => index > 11 && String(value).trim().toLowerCase() === "3 month average");
  assert.ok(ownPrice3mColumn >= 0, "Price growth sheet must expose the expected own-price three-month average");

  const wage = rowsOf(workbook, "Wage growth");
  const wageHeaders = wage[1] ?? [];
  const realised3mColumn = wageHeaders.findIndex((value, index) => index > 0 && String(value).trim().toLowerCase() === "3 month average");
  const expected3mColumn = wageHeaders.findIndex((value, index) => index > 3 && String(value).trim().toLowerCase() === "3 month average");
  assert.ok(realised3mColumn >= 0 && expected3mColumn >= 0, "Wage growth sheet must expose both labeled three-month averages");

  const source = new Map([
    ["uk-dmp-inflation-exp-1y", indexedRows(cpi, 0, cpi1yColumn, 4)],
    ["uk-dmp-inflation-exp-3y", indexedRows(cpi, 0, cpi3yColumn, 4)],
    ["uk-dmp-own-price-exp-1y", indexedRows(price, 0, ownPrice3mColumn, 4)],
    ["uk-dmp-wage-exp-1y", indexedRows(wage, 0, expected3mColumn, 2)],
    ["uk-dmp-wage-exp-1y-3m", indexedRows(wage, 0, expected3mColumn, 2)],
    ["uk-dmp-wage-growth-3m", indexedRows(wage, 0, realised3mColumn, 2)],
  ]);
  const client = createClient({ url: `file:${path.resolve("data/macro.db").replaceAll("\\", "/")}` });
  await fs.mkdir(auditDir, { recursive: true });

  try {
    const ids = [...source.keys()];
    const placeholders = ids.map(() => "?").join(",");
    const oldObservations = await client.execute({
      sql: `SELECT id,metric_id,date,value,raw_value,released_at,vintage_date,is_latest FROM observations WHERE metric_id IN (${placeholders}) ORDER BY metric_id,date,id`,
      args: ids,
    });
    const oldReleases = await client.execute({
      sql: `SELECT * FROM releases WHERE metric_id IN (${placeholders}) ORDER BY metric_id,period_date,released_at,id`,
      args: ids,
    });
    const oldMetrics = await client.execute({
      sql: `SELECT id,earliest_available,observation_count,last_ingested_at FROM metrics WHERE id IN (${placeholders})`,
      args: ids,
    });

    const comparison = ids.map((id) => {
      const expected = source.get(id);
      const stored = oldObservations.rows.filter((row) => row.metric_id === id);
      const storedByDate = new Map(stored.map((row) => [String(row.date), Number(row.value)]));
      const points = [...expected.entries()].sort(([a], [b]) => a.localeCompare(b));
      const changed = points.filter(([date, value]) => storedByDate.has(date) && !sameValue(storedByDate.get(date), value))
        .map(([date, official]) => ({ date, stored: storedByDate.get(date), official }));
      const missing = points.filter(([date]) => !storedByDate.has(date)).map(([date, value]) => ({ date, official: value }));
      const extras = stored.filter((row) => !expected.has(String(row.date))).map((row) => ({ date: String(row.date), value: Number(row.value) }));
      const latest = latestPoint(expected);
      return { id, source: workbookSource, officialSource, sourceCount: points.length, firstDate: points[0]?.[0], latest: latest && { date: latest[0], value: latest[1] }, storedCount: stored.length, changed, missing, extras };
    });

    const report = {
      workbookPath,
      officialSource,
      workbookSource,
      asOf: new Date().toISOString(),
      applied: apply,
      series: comparison,
      existingReleaseRows: oldReleases.rows,
      existingMetricMetadata: oldMetrics.rows,
    };
    await fs.writeFile(path.join(auditDir, "comparison.json"), JSON.stringify(report, null, 2));

    if (apply) {
      const tx = await client.transaction("write");
      try {
        const releaseByMetric = new Map(ids.map((id) => [id, oldReleases.rows.filter((row) => row.metric_id === id)]));
        const timestampByMetric = new Map();
        for (const id of ids) {
          const rows = releaseByMetric.get(id) ?? [];
          const event = rows.find((row) => String(row.released_at).startsWith(`${releaseDate}T`));
          timestampByMetric.set(id, event ? String(event.released_at) : releaseAtFallback);
          const points = source.get(id);
          const ordered = [...points.entries()].sort(([a], [b]) => a.localeCompare(b));
          const last = ordered.at(-1)?.[0];
          const oldByDate = new Map(oldObservations.rows.filter((row) => row.metric_id === id).map((row) => [String(row.date), row]));

          await tx.execute({ sql: "DELETE FROM observations WHERE metric_id = ?", args: [id] });
          for (let offset = 0; offset < ordered.length; offset += 100) {
            const chunk = ordered.slice(offset, offset + 100);
            const values = chunk.map(() => "(?,?,?,?,?,?,?)").join(",");
            const args = chunk.flatMap(([date, value]) => {
              const old = oldByDate.get(date);
              const releasedAt = old?.released_at != null
                ? String(old.released_at)
                : date === "2026-10-01" ? timestampByMetric.get(id) : null;
              return [id, date, value, value, releasedAt, vintageDate, date === last ? 1 : 0];
            });
            await tx.execute({
              sql: `INSERT INTO observations(metric_id,date,value,raw_value,released_at,vintage_date,is_latest) VALUES ${values}`,
              args,
            });
          }
          await tx.execute({
            sql: "UPDATE metrics SET earliest_available = ?, observation_count = ?, last_ingested_at = ? WHERE id = ?",
            args: [ordered[0][0], ordered.length, new Date().toISOString(), id],
          });
        }

        for (const id of ids) {
          const points = source.get(id);
          const rows = releaseByMetric.get(id) ?? [];
          for (const row of rows) {
            const period = String(row.period_date);
            const value = points.get(period);
            if (value == null) continue;
            const priorDate = previousMonth(period);
            const prior = points.get(priorDate) ?? null;
            await tx.execute({
              sql: `UPDATE releases SET value=?,prior_period_value=?,prior_period_date=?,change_vs_prior_period=?,notes=? WHERE id=?`,
              args: [value, prior, prior == null ? null : priorDate, prior == null ? null : value - prior,
                `Official BoE DMP workbook backfill (${period.slice(0, 7)}; source: ${workbookSource})`, Number(row.id)],
            });
          }

          const currentValue = points.get("2026-10-01");
          const priorValue = points.get("2026-09-01") ?? null;
          if (currentValue == null) throw new Error(`${id}: official October point is missing`);
          const octoberRows = rows.filter((row) => String(row.period_date) === "2026-10-01")
            .sort((a, b) => String(b.released_at).localeCompare(String(a.released_at)));
          const existingOctober = octoberRows[0]
            ?? rows.filter((row) => String(row.released_at).startsWith(`${releaseDate}T`))
              .sort((a, b) => String(b.released_at).localeCompare(String(a.released_at)))[0];
          const releasedAt = existingOctober ? String(existingOctober.released_at) : releaseAtFallback;
          const common = ["2026-10-01", releasedAt, currentValue, priorValue, priorValue == null ? null : "2026-09-01",
            priorValue == null ? null : currentValue - priorValue, `Official BoE DMP October 2026 workbook backfill (${workbookSource})`];
          if (existingOctober) {
            await tx.execute({
              sql: `UPDATE releases SET period_date=?,released_at=?,value=?,expected_value=NULL,prior_period_value=?,prior_period_date=?,change_vs_prior_period=?,supporting_doc_url=?,notes=? WHERE id=?`,
              args: [...common.slice(0, 6), officialSource, common[6], Number(existingOctober.id)],
            });
          } else {
            await tx.execute({
              sql: `INSERT INTO releases(metric_id,period_date,released_at,value,expected_value,prior_period_value,prior_period_date,prior_release_value,change_vs_prior_period,change_vs_prior_release,supporting_doc_url,notes)
                    VALUES(?,?,?, ?,NULL,?,?,NULL,?,NULL,?,?)`,
              args: [id, ...common.slice(0, 6), officialSource, common[6]],
            });
          }

          const committedOctober = await tx.execute({
            sql: "SELECT id FROM releases WHERE metric_id=? AND period_date='2026-10-01' ORDER BY released_at DESC,id DESC LIMIT 1",
            args: [id],
          });
          const octoberReleaseId = Number(committedOctober.rows[0]?.id ?? 0);
          if (octoberReleaseId) {
            await tx.execute({
              sql: "UPDATE release_dispatch_state SET release_id=? WHERE metric_id=? AND scheduled_at LIKE '2026-10-30%' AND status='processed'",
              args: [octoberReleaseId, id],
            });
          }
        }
        await tx.commit();
      } catch (error) {
        await tx.rollback();
        throw error;
      } finally {
        tx.close();
      }

      for (const id of ids) {
        const rows = await client.execute({ sql: "SELECT date,value,is_latest FROM observations WHERE metric_id=? ORDER BY date", args: [id] });
        const expected = [...source.get(id).entries()].sort(([a], [b]) => a.localeCompare(b));
        assert.deepEqual(rows.rows.map((row) => [String(row.date), Number(row.value)]), expected, `${id}: stored history must match official workbook`);
        assert.equal(rows.rows.filter((row) => Number(row.is_latest) === 1).length, 1, `${id}: exactly one latest observation`);
        const release = await client.execute({ sql: "SELECT period_date,value,released_at FROM releases WHERE metric_id=? AND period_date='2026-10-01' ORDER BY released_at DESC LIMIT 1", args: [id] });
        assert.equal(release.rows.length, 1, `${id}: October release row must exist`);
        assert.ok(sameValue(release.rows[0].value, source.get(id).get("2026-10-01")), `${id}: October release must match workbook`);
        const completion = await client.execute({ sql: "SELECT s.release_id,r.period_date,r.value FROM release_dispatch_state s LEFT JOIN releases r ON r.id=s.release_id WHERE s.metric_id=? AND s.scheduled_at='2026-10-30T09:30:00+00:00'", args: [id] });
        if (completion.rows.length) {
          assert.equal(String(completion.rows[0].period_date), "2026-10-01", `${id}: scheduled completion must point to the October release`);
          assert.ok(sameValue(completion.rows[0].value, source.get(id).get("2026-10-01")), `${id}: scheduled completion must match workbook`);
        }
      }
    }

    console.log(JSON.stringify({ applied: apply, auditDir, series: comparison.map((item) => ({
      id: item.id,
      sourceCount: item.sourceCount,
      firstDate: item.firstDate,
      latest: item.latest,
      storedCount: item.storedCount,
      mismatches: item.changed.length,
      missing: item.missing.length,
      extras: item.extras.length,
    })) }, null, 2));
  } finally {
    client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
