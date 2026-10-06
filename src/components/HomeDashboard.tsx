"use client";
import Link from 'next/link';
import { COUNTRY_META, type Region } from '@/catalog/hierarchy';

const regions: Region[] = ['US','UK','EA'];
export function HomeDashboard() {
 return <div className="mx-auto max-w-6xl px-5 pb-20 pt-10 sm:px-8 lg:pt-16">
  <header className="max-w-3xl"><div className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--accent-ink)]">MacroHub</div><h1 className="mt-3 font-[family-name:var(--font-display)] text-4xl font-bold tracking-tight sm:text-6xl">Global Macro Dashboard</h1><p className="mt-5 text-base leading-7 text-[var(--muted)]">Track inflation, growth and jobs across the United States, United Kingdom and Euro Area. Choose a region to open its indicators, component hierarchies and detailed historical series.</p></header>
  <section className="mt-12 grid gap-5 md:grid-cols-3">{regions.map(r=><Link href={`/country/${r.toLowerCase()}`} key={r} className="group rounded-3xl border border-[var(--line)] bg-[var(--panel)] p-7 shadow-sm transition hover:-translate-y-1 hover:border-[var(--accent)]/50"><div className="text-5xl">{COUNTRY_META[r].flag}</div><h2 className="mt-7 font-[family-name:var(--font-display)] text-2xl font-semibold">{COUNTRY_META[r].name}</h2><p className="mt-2 text-sm text-[var(--muted)]">Key Indicators · Inflation · Growth · Jobs</p><div className="mt-8 text-sm font-semibold text-[var(--accent-ink)]">Open dashboard <span className="inline-block transition group-hover:translate-x-1">→</span></div></Link>)}</section>
 </div>
}
