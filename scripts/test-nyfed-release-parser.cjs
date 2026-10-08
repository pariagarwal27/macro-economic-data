/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require(path.join(process.cwd(), 'node_modules/typescript'));
const sourcePath = path.join(process.cwd(), 'src/ingest/nyfed.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
const loaded = new Module(sourcePath, module);
loaded.filename = sourcePath;
loaded.paths = Module._nodeModulePaths(path.dirname(sourcePath));
loaded._compile(compiled, sourcePath);
const parse = loaded.exports.parseSceInflationRelease;
assert.equal(typeof parse, 'function', 'adapter should export the SCE release parser');
const html = `<!doctype html><html><body>
  <h1>Short- and Medium-Term Inflation Expectations Increase</h1>
  <p>October 07, 2026</p>
  <p>NEW YORK—The Federal Reserve Bank of New York today released the September 2026 Survey of Consumer Expectations.</p>
  <p>Median inflation expectations increased by 0.3 percentage point at the one-year-ahead horizon to 3.9 percent and by 0.1 percentage point at the three-year-ahead horizon to 3.3 percent. Expectations remained unchanged at the five-year-ahead horizon at 3.0 percent.</p>
</body></html>`;
assert.deepEqual(parse(html, 'SCE_INFLATION_1Y'), [{ date: '2026-09-01', value: 3.9 }]);
assert.deepEqual(parse(html, 'SCE_INFLATION_3Y'), [{ date: '2026-09-01', value: 3.3 }]);
assert.deepEqual(parse(html, 'SCE_INFLATION_5Y'), [{ date: '2026-09-01', value: 3.0 }]);
assert.deepEqual(
  loaded.exports.mergeLatestOfficialPoint(
    [{ date: '2026-08-01', value: 3.6 }],
    { date: '2026-09-01', value: 3.9 }
  ),
  [{ date: '2026-08-01', value: 3.6 }, { date: '2026-09-01', value: 3.9 }]
);
assert.deepEqual(
  loaded.exports.mergeLatestOfficialPoint(
    [{ date: '2026-09-01', value: 3.5 }],
    { date: '2026-09-01', value: 3.9 }
  ),
  [{ date: '2026-09-01', value: 3.9 }]
);
assert.throws(() => parse('<p>release without a series value</p>', 'SCE_INFLATION_1Y'));
console.log('PASS NY Fed SCE release parser and history-merge tests');
