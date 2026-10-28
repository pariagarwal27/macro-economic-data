import React from 'react';
type Reading = { title: string; mom: number | null | undefined; yoy: number | null | undefined; trend: number | null | undefined };
type Props = { measure: string; readings: Reading[]; observation: string; source: string; updated: string; trendLabel?: string };
const rate = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;

export function UkRetailPublishedReadings({ measure, readings, observation, source, updated, trendLabel = "3m/3m" }: Props) {
  return <div className="uk-retail-published-readings" style={{ gridColumn: '1 / -1', display: 'grid', gap: 12 }}>
    <div className="retail-published-reading-grid">
      {readings.map(reading => <section key={reading.title} aria-label={`${reading.title} published reading`} style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignContent: 'start', alignItems: 'baseline', columnGap: 12, rowGap: 12 }}>
        <h5 style={{ gridColumn: '1 / -1', margin: 0, fontSize: 14 }}>{reading.title}</h5>
        {measure === 'mom' ? <><span>MoM</span><strong>{rate(reading.mom)}</strong></> : <>
          <span>YoY</span><strong>{rate(reading.yoy)}</strong>
          <span>{trendLabel}</span><strong>{rate(reading.trend)}</strong>
        </>}
      </section>)}
    </div>
    <section className="uk-retail-published-metadata" aria-label="Retail sales publication details" style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '4px 12px', background: 'var(--panel)' }}>
      <dl style={{ margin: 0 }}>
        <div><dt>Observation</dt><dd>{observation}</dd></div>
        <div><dt>Source</dt><dd>{source}</dd></div>
        <div><dt>Updated</dt><dd>{updated}</dd></div>
      </dl>
    </section>
  </div>;
}
