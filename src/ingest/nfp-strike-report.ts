import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import { executeSql } from '@/db';

const SOURCE = 'https://www.bls.gov/ces/publications/strike-report.htm';
const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];

export function parseStrikeReport(html: string) {
  const $ = load(html);
  const text = $('body').text().replace(/\s+/g, ' ');
  const match = text.match(/summary of strike activity during CES survey reference pay period,\s*(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i);
  const totals = $('tr').toArray().map(row => $(row).find('td,th').toArray().map(cell => $(cell).text().trim())).filter(cells => /^total on strike$/i.test(cells[0] ?? ''));
  if (!match || totals.length !== 1 || !/^\d[\d,]*$/.test(totals[0][1] ?? '')) throw new Error('Unrecognized BLS strike report');
  return { referenceMonth: `${match[2]}-${String(MONTHS.indexOf(match[1].toLowerCase()) + 1).padStart(2, '0')}`, workers: Number(totals[0][1].replace(/,/g, '')) };
}

export async function captureStrikeReport(fetcher: typeof fetch = fetch) {
  const response = await fetcher(SOURCE, { headers: { accept: 'text/html', 'user-agent': 'MacroEconomicDashboard/1.0' }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`BLS strike report HTTP ${response.status}`);
  const html = await response.text();
  const capturedAt = new Date().toISOString();
  const parsed = parseStrikeReport(html);
  const hash = createHash('sha256').update(html).digest('hex');
  await executeSql(`CREATE TABLE IF NOT EXISTS nfp_strike_archive (source_url TEXT NOT NULL, reference_month TEXT NOT NULL, workers INTEGER NOT NULL, captured_at TEXT NOT NULL, source_sha256 TEXT NOT NULL, source_html TEXT NOT NULL, UNIQUE(reference_month,source_sha256))`);
  await executeSql({sql: 'INSERT OR IGNORE INTO nfp_strike_archive VALUES (?,?,?,?,?,?)', args: [SOURCE, parsed.referenceMonth, parsed.workers, capturedAt, hash, html]});
  return { ...parsed, capturedAt, hash, status: 'official_source_captured_publication_time_unverified' };
}
