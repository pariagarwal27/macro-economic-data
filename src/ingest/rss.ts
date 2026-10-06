import type { RawPoint } from "./transforms";

export interface FeedItem {
  id: string;
  title: string;
  link: string;
  publishedAt: string | null;
  summary: string | null;
  source: string;
}

const FEEDS: { id: string; url: string; source: string }[] = [
  { id: "bls-latest", url: "https://www.bls.gov/feed/bls_latest.rss", source: "bls" },
  { id: "bls-empsit", url: "https://www.bls.gov/feed/empsit.rss", source: "bls" },
  { id: "bls-cpi", url: "https://www.bls.gov/feed/cpi.rss", source: "bls" },
  { id: "bls-ppi", url: "https://www.bls.gov/feed/ppi.rss", source: "bls" },
  { id: "bls-eci", url: "https://www.bls.gov/feed/eci.rss", source: "bls" },
  { id: "bls-jolts", url: "https://www.bls.gov/feed/jolts.rss", source: "bls" },
  { id: "bea", url: "https://apps.bea.gov/rss/rss.xml", source: "bea" },
  { id: "fed", url: "https://www.federalreserve.gov/feeds/press_all.xml", source: "fed" },
  {
    id: "ons-govuk",
    url: "https://www.gov.uk/search/news-and-communications.atom?organisations%5B%5D=office-for-national-statistics",
    source: "ons",
  },
  { id: "ecb-stats", url: "https://www.ecb.europa.eu/rss/statpress.html", source: "ecb" },
];

/** Keyword hints → metric ids for attaching supporting release docs from RSS. */
const TOPIC_METRICS: { pattern: RegExp; metricIds: string[] }[] = [
  { pattern: /employment situation|payroll|unemployment rate/i, metricIds: ["us-nfp", "us-unemployment"] },
  { pattern: /consumer price index|\bcpi\b/i, metricIds: ["us-cpi-yoy", "us-cpi-mom", "us-core-cpi-yoy"] },
  { pattern: /producer price|\bppi\b/i, metricIds: ["us-ppi-final-demand", "us-ppi-core"] },
  { pattern: /employment cost index|\beci\b/i, metricIds: ["us-eci-wages", "us-eci-total"] },
  { pattern: /job openings|jolts/i, metricIds: ["us-jolts-openings", "us-jolts-quits"] },
  { pattern: /gross domestic product|\bgdp\b|personal income|pce/i, metricIds: ["us-gdp-real", "us-pce", "us-core-pce"] },
  { pattern: /consumer price inflation|cpih|producer price inflation/i, metricIds: ["uk-cpi-yoy", "uk-cpih-yoy", "uk-ppi-output-yoy"] },
  { pattern: /labour market|average weekly earnings|vacancies/i, metricIds: ["uk-unemployment", "uk-awe-regular-yoy", "uk-vacancies"] },
  { pattern: /index of production|industrial production/i, metricIds: ["uk-industrial-production", "ea-industrial-production"] },
  { pattern: /retail sales/i, metricIds: ["uk-retail-sales", "ea-retail-sales"] },
  { pattern: /euro area.*inflation|hicp|harmonised index/i, metricIds: ["ea-hicp-yoy", "ea-core-hicp-yoy"] },
  { pattern: /euro area.*unemployment|harmonised unemployment/i, metricIds: ["ea-unemployment", "ea-youth-unemployment"] },
];

export async function fetchReleaseFeeds(): Promise<FeedItem[]> {
  const items: FeedItem[] = [];
  await Promise.all(
    FEEDS.map(async (feed) => {
      try {
        const res = await fetch(feed.url, {
          headers: {
            Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
            "User-Agent": "macro-economy-tracker/1.0",
          },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const xml = await res.text();
        items.push(...parseFeed(xml, feed.source, feed.id));
      } catch (err) {
        console.warn(`[rss] ${feed.id} failed:`, err instanceof Error ? err.message : err);
      }
    })
  );
  return items.sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
}

export function mapFeedItemsToMetrics(items: FeedItem[]): Map<string, FeedItem> {
  const out = new Map<string, FeedItem>();
  for (const item of items) {
    const hay = `${item.title} ${item.summary ?? ""}`;
    for (const topic of TOPIC_METRICS) {
      if (!topic.pattern.test(hay)) continue;
      for (const id of topic.metricIds) {
        if (!out.has(id)) out.set(id, item);
      }
    }
  }
  return out;
}

function parseFeed(xml: string, source: string, feedId: string): FeedItem[] {
  if (/<feed[\s>]/i.test(xml)) return parseAtom(xml, source, feedId);
  return parseRss(xml, source, feedId);
}

function parseRss(xml: string, source: string, feedId: string): FeedItem[] {
  const items: FeedItem[] = [];
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
  for (const block of blocks.slice(0, 25)) {
    const title = textOf(block, "title");
    const link = textOf(block, "link") || attr(block, "link", "href");
    if (!title || !link) continue;
    items.push({
      id: `${feedId}:${hash(link)}`,
      title: decode(title),
      link: decode(link),
      publishedAt: toIso(textOf(block, "pubDate") || textOf(block, "dc:date")),
      summary: decode(textOf(block, "description")),
      source,
    });
  }
  return items;
}

function parseAtom(xml: string, source: string, feedId: string): FeedItem[] {
  const items: FeedItem[] = [];
  const blocks = xml.match(/<entry\b[\s\S]*?<\/entry>/gi) ?? [];
  for (const block of blocks.slice(0, 25)) {
    const title = textOf(block, "title");
    const link =
      attr(block, "link", "href") ||
      textOf(block, "link") ||
      textOf(block, "id");
    if (!title || !link) continue;
    items.push({
      id: `${feedId}:${hash(link)}`,
      title: decode(title),
      link: decode(link),
      publishedAt: toIso(textOf(block, "updated") || textOf(block, "published")),
      summary: decode(textOf(block, "summary") || textOf(block, "content")),
      source,
    });
  }
  return items;
}

function textOf(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = block.match(re);
  if (!m) return null;
  return stripCdata(m[1]).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || null;
}

function attr(block: string, tag: string, name: string): string | null {
  const re = new RegExp(`<${tag}[^>]*\\s${name}=["']([^"']+)["'][^>]*/?>`, "i");
  const m = block.match(re);
  return m?.[1] ?? null;
}

function stripCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

function decode(s: string | null): string {
  if (!s) return "";
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function toIso(raw: string | null): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? raw : d.toISOString();
}

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

/** Expose for tests / scripts — unused RawPoint import keeps module shape stable for future numeric RSS tips. */
export type _RssPoint = RawPoint;
