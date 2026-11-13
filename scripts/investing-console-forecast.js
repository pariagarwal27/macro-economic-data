// Run in the Investing.com economic-calendar page's developer console.
// Extracts the currently loaded rows only; check filters, dates, timezone and
// any Load more button before using the result.
(() => {
  const table = [...document.querySelectorAll("table")].find(element =>
    [...element.querySelectorAll("thead th")].some(cell => cell.textContent.trim() === "Forecast")
  );
  if (!table) throw new Error("Economic calendar forecast table is not present.");
  const rows = [];
  let date = null;
  for (const row of table.querySelectorAll("tbody tr")) {
    const cells = [...row.querySelectorAll(":scope > td")];
    if (cells.length === 1) {
      date = cells[0].textContent.trim();
      continue;
    }
    if (!row.id || cells.length < 8) continue;
    const event = cells[3].querySelector("a");
    if (!event) continue;
    rows.push({
      date,
      time: cells[1].textContent.trim(),
      country: cells[2].textContent.trim(),
      event: event.textContent.trim(),
      forecast: cells[6].textContent.trim() || null,
      eventId: row.id,
    });
  }
  const result = { capturedAt: new Date().toISOString(), page: location.href, rows };
  console.log("Investing.com visible forecasts:", result);
  return result;
})();
