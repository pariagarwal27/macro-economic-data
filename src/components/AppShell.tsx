"use client";

import Link from "next/link";
import { CalendarDays, Globe2 } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isCountryPage = pathname?.startsWith("/country/");

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
          <Link href="/country/uk">Countries</Link>
          <Link href="/calendar" aria-current={pathname === "/calendar" ? "page" : undefined}>Calendar</Link>
        </nav>
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
