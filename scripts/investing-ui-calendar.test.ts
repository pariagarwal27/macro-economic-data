import assert from "node:assert/strict";
import { parseVisibleForecasts } from "./investing-ui-calendar";

const html = `<table><thead><tr><th>Time</th><th>Cur.</th><th>Event</th><th>Imp.</th><th>Actual</th><th>Forecast</th><th>Previous</th></tr></thead><tbody>
<tr><td colspan="8">Thursday, November 12, 2026</td></tr>
<tr id="294-1"><td></td><td>13:30</td><td>US</td><td><a>Initial Jobless Claims</a></td><td></td><td>200K</td><td>194K</td><td>191K</td></tr>
</tbody></table>`;
const rows = parseVisibleForecasts(html, "2026-11-12");
assert.equal(rows.length, 1);
assert.equal(rows[0].forecast, "194K");
assert.equal(rows[0].time, "13:30");
assert.throws(() => parseVisibleForecasts(html, "2026-11-13"));
assert.throws(() => parseVisibleForecasts("<h1>Access denied</h1>", "2026-11-12"));
console.log("Visible Investing forecast parsing checks passed");
