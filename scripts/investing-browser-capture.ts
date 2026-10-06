/**
 * Shared browser-side helpers for Investing.com calendar capture.
 * Injected via CDP Runtime.evaluate — not run by Node directly.
 *
 * KEEP_COUNTRIES includes AU per product request (stored even if unmapped).
 */
export const INVESTING_KEEP_COUNTRIES = ["US", "UK", "EA", "DE", "FR", "IT", "ES", "AU"] as const;

/** Source text for CDP injection (load-more + DOM extract). */
export const INVESTING_BROWSER_CAPTURE_JS = `
async function __invCaptureMonth(dateFromPicker, dateToPicker, rangeFrom, rangeTo) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const KEEP = new Set(${JSON.stringify(["US", "UK", "EA", "DE", "FR", "IT", "ES", "AU"])});

  function setNativeValue(el, value) {
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    desc.set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // Open custom dates if needed
  let start = document.getElementById("date-picker-start-day");
  let end = document.getElementById("date-picker-end-day");
  if (!start || !end) {
    const btn = [...document.querySelectorAll("button")].find((b) => /Custom dates/i.test(b.textContent || ""));
    if (btn) btn.click();
    await sleep(700);
    start = document.getElementById("date-picker-start-day");
    end = document.getElementById("date-picker-end-day");
  }
  if (!start || !end) return { ok: false, reason: "no-date-inputs" };

  start.focus();
  setNativeValue(start, dateFromPicker);
  await sleep(250 + Math.random() * 200);
  end.focus();
  setNativeValue(end, dateToPicker);
  await sleep(300 + Math.random() * 200);

  for (const sel of ['[class*="auth_popup"]', '[class*="modal"]']) {
    for (const el of document.querySelectorAll(sel)) {
      const node = el;
      if (node instanceof HTMLElement) node.style.display = "none";
    }
  }
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

  const apply = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Apply");
  if (apply) apply.click();
  await sleep(2800 + Math.random() * 800);

  const countRows = () => document.querySelectorAll("table[class*=datatable] tr").length;
  const findLoadMore = () =>
    [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Load more");

  let prev = countRows();
  let clicks = 0;
  const log = [{ step: "start", rows: prev }];
  for (let i = 0; i < 30; i++) {
    const btn = findLoadMore();
    if (!btn) {
      log.push({ step: "no-button", rows: countRows(), clicks });
      break;
    }
    window.scrollBy(0, Math.floor(window.innerHeight * 0.65));
    await sleep(450 + Math.random() * 450);
    btn.scrollIntoView({ behavior: "smooth", block: "center" });
    await sleep(550 + Math.random() * 550);
    btn.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    await sleep(150 + Math.random() * 200);
    btn.click();
    clicks++;
    let grew = false;
    for (let w = 0; w < 24; w++) {
      await sleep(400);
      const now = countRows();
      if (now > prev) {
        grew = true;
        prev = now;
        break;
      }
    }
    log.push({ step: "click", i, rows: countRows(), grew, clicks });
    if (!grew) {
      await sleep(1800);
      if (countRows() <= prev) {
        log.push({ step: "stalled", rows: countRows() });
        break;
      }
      prev = countRows();
    }
    await sleep(900 + Math.random() * 1100);
  }

  const codeMap = {
    US: ["US", "USD"], UK: ["UK", "GBP"], GB: ["UK", "GBP"], EU: ["EA", "EUR"], EZ: ["EA", "EUR"], EA: ["EA", "EUR"],
    DE: ["DE", "EUR"], FR: ["FR", "EUR"], IT: ["IT", "EUR"], ES: ["ES", "EUR"], AU: ["AU", "AUD"],
    JP: ["JP", "JPY"], CN: ["CN", "CNY"], CA: ["CA", "CAD"], CH: ["CH", "CHF"], NZ: ["NZ", "NZD"],
  };
  const MONTHS = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8,
    september: 9, october: 10, november: 11, december: 12,
  };
  function parseHeaderDate(h) {
    const m = h.match(/([A-Za-z]+)\\s+(\\d{1,2}),\\s*(\\d{4})/);
    if (!m) return null;
    const mo = MONTHS[m[1].toLowerCase()];
    if (!mo) return null;
    return m[3] + "-" + String(mo).padStart(2, "0") + "-" + String(+m[2]).padStart(2, "0");
  }
  const clean = (t) => (t || "").replace(/\\u00a0/g, " ").replace(/\\s+/g, " ").trim();
  const table = document.querySelector("table[class*=datatable]");
  if (!table) return { ok: false, reason: "no-table", log };

  const rows = [];
  let currentDate = null;
  for (const tr of table.querySelectorAll("tr")) {
    const tds = [...tr.querySelectorAll("td")];
    if (!tds.length) continue;
    const dayText = clean(tds[0].textContent);
    if (/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i.test(dayText) && tds.length <= 2) {
      currentDate = parseHeaderDate(dayText);
      continue;
    }
    if (tds.length < 6) continue;
    const time = clean(tds[1]?.textContent);
    if (!/^\\d{1,2}:\\d{2}$/.test(time) && time !== "All Day") continue;
    const code = clean(tds[2]?.textContent).toUpperCase();
    const mapped = codeMap[code] || [code, null];
    if (!KEEP.has(mapped[0])) continue;
    const eventCell = tds[3];
    const event = clean(eventCell.querySelector("a")?.textContent);
    if (!event) continue;
    const blob = clean(eventCell.textContent);
    const actM = blob.match(/Act:([^C]*?)(?:Cons:|$)/);
    const consM = blob.match(/Cons:([^P]*?)(?:Prev\\.:|$)/);
    const prevM = blob.match(/Prev\\.:?(.*)$/);
    let actual = clean(tds[5]?.textContent) || null;
    let forecast = clean(tds[6]?.textContent) || null;
    let previous = clean(tds[7]?.textContent) || null;
    if (!actual && actM) actual = clean(actM[1]);
    if (!forecast && consM) forecast = clean(consM[1]);
    if (!previous && prevM) previous = clean(prevM[1]);
    if (actual === "-" || actual === "") actual = null;
    if (forecast === "-" || forecast === "") forecast = null;
    if (previous === "-" || previous === "") previous = null;
    let importance = null;
    const vol = tr.querySelector('[title*="Volatility"]');
    if (vol) {
      const t = vol.getAttribute("title") || "";
      importance = /High/i.test(t) ? 3 : /Moderate/i.test(t) ? 2 : /Low/i.test(t) ? 1 : null;
    }
    rows.push({
      date: currentDate,
      time: time === "All Day" ? "00:00" : time,
      currency: mapped[1],
      country: mapped[0],
      event,
      importance,
      actual,
      forecast,
      previous,
    });
  }

  const dump = {
    source: "investing",
    timezone: "BST",
    range: { from: rangeFrom, to: rangeTo },
    note: "Human-like browser Load more; UI GMT+1/BST; countries US/UK/EA/DE/FR/IT/ES/AU",
    rows,
  };
  window.__invLastDump = dump;
  return {
    ok: true,
    clicks,
    tableRows: countRows(),
    dumpRows: rows.length,
    auRows: rows.filter((r) => r.country === "AU").length,
    stillHasLoadMore: !!findLoadMore(),
    log,
    bytes: JSON.stringify(dump).length,
  };
}
`;
