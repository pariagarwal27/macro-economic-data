import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import assert from 'node:assert/strict';
import test from 'node:test';
import { UkRetailPublishedReadings } from './UkRetailPublishedReadings';

for (const measure of ['mom','paired']) test(`${measure} readings share publication metadata and keep dates out of measure labels`, () => {
  const html = renderToStaticMarkup(<UkRetailPublishedReadings measure={measure} readings={[
    {title:'Headline Retail Sales',mom:-0.4,yoy:0.8,trend:0.7},
    {title:'Retail Sales ex Fuel',mom:-0.7,yoy:0.8,trend:0.4},
  ]} observation="1 Sept 2026" source="ONS" updated="23 Oct 2026" />);
  assert.equal((html.match(/1 Sept 2026/g) ?? []).length,1);
  assert.equal((html.match(/<dt>Observation<\/dt>/g) ?? []).length,1);
  assert.equal((html.match(/<dt>Source<\/dt>/g) ?? []).length,1);
  assert.equal((html.match(/<dt>Updated<\/dt>/g) ?? []).length,1);
  assert.ok(html.includes(measure === 'mom' ? '-0.7%' : '+0.4%'));
  assert.ok(html.includes(measure === 'mom' ? '<span>MoM</span>' : '<span>3m/3m</span>'));
  assert.ok(!html.includes(' · '));
});
