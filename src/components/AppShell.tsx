"use client";

import Link from "next/link";
import { CalendarDays, Globe2 } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { GlobalMetricSearch } from "./GlobalMetricSearch";
import { prefetchClientJson } from "@/lib/client-json-cache";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isCountryPage = pathname?.startsWith("/country/");

  useEffect(() => {
    let cancelled = false;
    const warmLink = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest<HTMLAnchorElement>("a[href]");
      if (!link || link.origin !== window.location.origin) return;
      const country = /^\/country\/(us|uk|ea)$/i.exec(link.pathname)?.[1]?.toUpperCase();
      if (country) void prefetchClientJson(`dashboard:${country}`, `/api/dashboard/${country}`);
    };
    document.addEventListener("pointerover", warmLink);
    document.addEventListener("focusin", warmLink);
    const timer = window.setTimeout(async () => {
      // Warm sequentially so background countries do not compete with the visible page.
      const current = /^\/country\/(us|uk|ea)$/i.exec(window.location.pathname)?.[1]?.toUpperCase();
      const countries = [...new Set([...(current ? [current] : []), "US", "UK", "EA"])];
      for (const country of countries) {
        if (cancelled) return;
        router.prefetch(`/country/${country.toLowerCase()}`);
        await prefetchClientJson(`dashboard:${country}`, `/api/dashboard/${country}`);
      }
      if (!cancelled) await prefetchClientJson("overview", "/api/overview");
    }, 1000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("pointerover", warmLink);
      document.removeEventListener("focusin", warmLink);
    };
  }, [router]);

  useEffect(() => {
    const saved = window.localStorage.getItem("macrohub-editorial-theme");
    document.documentElement.dataset.theme = saved === "dark" ? "dark" : "light";
  }, [isCountryPage]);

  if (isCountryPage) return <>{children}</>;

  return (
    <div className="min-h-screen bg-[var(--paper)]">
      <header className="site-header">
        <Link href="/" className="site-brand">
          <span className="site-brand-icon"><Globe2 size={25} /></span>
          <span><b>MacroHub</b><small>Global Macro Dashboard</small></span>
        </Link>
        <nav className="editorial-primary-nav" aria-label="Main navigation">
          <Link href="/" aria-current={pathname === "/" ? "page" : undefined}>Overview</Link>
          <Link href="/country/us">Countries</Link>
          <Link href="/calendar" aria-current={pathname === "/calendar" ? "page" : undefined}>Calendar</Link>
          <Link href="/latest-updated" aria-current={pathname === "/latest-updated" ? "page" : undefined}>Latest Updated</Link>
        </nav>
        <GlobalMetricSearch />
        <div className="site-header-right">
          <Link href="/country/us" data-country="us" className="header-link">🇺🇸 US</Link>
          <Link href="/country/uk" data-country="uk" className="header-link">🇬🇧 UK</Link>
          <Link href="/country/ea" data-country="ea" className="header-link">🇪🇺 Euro Area</Link>
          {pathname !== "/" && <Link href="/calendar" className="header-link calendar-link"><CalendarDays size={15}/> Calendar</Link>}
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}
