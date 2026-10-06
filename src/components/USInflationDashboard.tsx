"use client";
import Link from 'next/link';import{useEffect,useState}from'react';import{formatObsDate}from'@/lib/format';
type Metric={id:string;name:string;source:string;officialUrl:string;docsUrl:string;date:string|null;yoy:number|null;mom:number|null;history:Array<{date:string;value:number}>};type Data={asOf:string|null;cpi:{headline:Metric|null;core:Metric|null};pce:{headline:Metric|null;core:Metric|null}};
function Spark({data}:{data:Array<{date:string;value:number}>}){if(data.length<2)return <div className="h-28"/>;const v=data.map(x=>x.value),min=Math.min(...v),max=Math.max(...v),span=max-min||1;const pts=v.map((x,i)=>`${i/(v.length-1)*100},${96-(x-min)/span*84}`).join(' ');return <svg viewBox="0 0 100 100" className="h-28 w-full" preserveAspectRatio="none"><polyline points={pts} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke"/></svg>}
function Box({m,label}:{m:Metric|null;label:string}){return <div className="rounded-xl border border-[var(--line)] bg-white/40 p-4"><div className="text-xs font-semibold uppercase tracking-[.14em] text-[var(--muted)]">{label}</div><div className="mt-3 grid grid-cols-2 gap-4"><div><div className="font-[family-name:var(--font-mono)] text-2xl font-semibold">{m?.yoy==null?'—':`${m.yoy.toFixed(2)}%`}</div><div className="text-xs text-[var(--muted)]">YoY</div></div><div><div className="font-[family-name:var(--font-mono)] text-2xl font-semibold">{m?.mom==null?'—':`${m.mom.toFixed(2)}%`}</div><div className="text-xs text-[var(--muted)]">MoM</div></div></div><div className="mt-3 text-[var(--accent-ink)]"><Spark data={m?.history??[]}/></div></div>}
function InflationCard({title,source,main,core,components}:{title:string;source:string;main:Metric|null;core:Metric|null;components:string}){return <section className="rounded-3xl border border-[var(--line)] bg-[var(--panel)] p-6"><div className="flex items-start justify-between"><div><div className="text-xs uppercase tracking-[.18em] text-[var(--accent-ink)]">{source}</div><h2 className="mt-1 font-[family-name:var(--font-display)] text-3xl font-semibold">{title}</h2></div><Link href={main?`/metrics/${main.id}`:'#'} className="text-xs font-semibold text-[var(--accent-ink)]">Detail →</Link></div><div className="mt-5 grid gap-3 sm:grid-cols-2"><Box m={main} label="Headline"/><Box m={core} label="Core"/></div><div className="mt-5 flex items-center justify-between border-t border-[var(--line)] pt-4"><span className="text-xs text-[var(--muted)]">YoY and MoM · current-year graph</span><Link href={components} className="rounded-xl bg-[var(--ink)] px-4 py-2 text-xs font-semibold text-[var(--paper)]">View all {title} components →</Link></div></section>}
export function USInflationDashboard(){const[data,setData]=useState<Data|null>(null);const[error,setError]=useState('');useEffect(() => {
  const load = () =>
    fetch("/api/us-inflation", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) {
          throw new Error(`API ${r.status}`);
        }

        return (await r.json()) as Data;
      })
      .then((json) => setData(json))
      .catch((e) => setError(e.message));

  load();

  const t = setInterval(load, 60000);

  return () => clearInterval(t);
}, []);return <div className="mx-auto max-w-7xl px-5 pb-20 pt-8 sm:px-8"><Link href="/country/us" className="text-sm text-[var(--accent-ink)]">← United States</Link><header className="mt-5"><div className="text-xs font-semibold uppercase tracking-[.18em] text-[var(--accent-ink)]">United States</div><h1 className="mt-2 font-[family-name:var(--font-display)] text-4xl font-bold">US Inflation</h1><p className="mt-2 text-sm text-[var(--muted)]">CPI and PCE. Headline and core show YoY and MoM, with current-year trends and component drilldowns.</p><div className="mt-3 text-xs text-[var(--muted)]">Data through {data?.asOf?formatObsDate(data.asOf):'—'} · Primary sources: BLS / BEA</div></header>{error&&<div className="mt-5 rounded-xl border border-[var(--down)]/30 bg-[var(--down)]/10 p-4 text-sm text-[var(--down)]">{error}</div>}<div className="mt-7 grid gap-5 lg:grid-cols-2"><InflationCard title="CPI" source="BLS" main={data?.cpi.headline??null} core={data?.cpi.core??null} components="/country/us/inflation/cpi"/><InflationCard title="PCE" source="BEA" main={data?.pce.headline??null} core={data?.pce.core??null} components="/country/us/inflation/pce"/></div></div>}
