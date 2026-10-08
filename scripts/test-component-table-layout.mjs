import assert from "node:assert/strict";
import fs from "node:fs";

const css = fs.readFileSync("src/app/globals.css", "utf8");
const dashboard = fs.readFileSync("src/components/CountryDashboard.tsx", "utf8");

const finalLayout = css.slice(css.lastIndexOf("/* Component detail table fit"));
assert.ok(finalLayout.length < css.length, "final component-table layout override exists");
const desktopRule = finalLayout.match(/\.detail-drawer \.component-table-head,\s*\.detail-drawer \.drawer-row\s*\{([^}]*)\}/s);
assert.ok(desktopRule, "header and rows share one final layout rule");
const desktopColumns = desktopRule[1].match(/grid-template-columns\s*:\s*([^;]+)\s*!important/i)?.[1];
assert.ok(desktopColumns, "desktop layout explicitly sets its grid columns");
assert.equal(desktopColumns.trim().split(/\s+/).length, 7, "desktop layout keeps all seven cells on one row");

const mobileRule = finalLayout.match(/@media\s*\(max-width:760px\)\s*\{\s*\.detail-drawer \.component-table-head,\s*\.detail-drawer \.drawer-row\s*\{([^}]*)\}/s);
assert.ok(mobileRule, "header and rows share a responsive layout rule");
const mobileColumns = mobileRule[1].match(/grid-template-columns\s*:\s*([^;]+)\s*!important/i)?.[1];
assert.ok(mobileColumns, "mobile layout explicitly sets its grid columns");
assert.equal(mobileColumns.trim().split(/\s+/).length, 7, "mobile layout keeps all seven cells on one row");

assert.ok(finalLayout.includes("@media"), "the final layout includes responsive sizing");
assert.match(finalLayout, /overflow-x\s*:\s*hidden/i, "the component table does not require horizontal scrolling");
assert.equal(
  (dashboard.match(/gridTemplateColumns: "34px minmax\(0, 1fr\) 78px 78px 78px minmax\(90px, 120px\) 34px"/g) ?? []).length,
  0,
  "component table JSX no longer hardcodes the oversized grid",
);

console.log("Component table layout checks passed.");
