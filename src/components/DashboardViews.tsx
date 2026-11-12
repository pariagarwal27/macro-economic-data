"use client";

import { HomeDashboard } from "./HomeDashboard";
import { CountryDashboardPanels } from "./CountryDashboardPanels";
import { ReleaseCalendar } from "./ReleaseCalendar";
import { WeeklyChanges } from "./WeeklyChanges";
import { isDashboardPath } from "@/lib/dashboard-navigation";

/** Own the main views in the persistent shell so tab clicks never await RSC. */
export function DashboardViews({ pathname, children }: { pathname: string; children: React.ReactNode }) {
  return <>
    <CountryDashboardPanels>{null}</CountryDashboardPanels>
    {pathname === "/" ? <HomeDashboard />
      : pathname === "/calendar" ? <ReleaseCalendar />
      : pathname === "/latest-updated" ? <div className="latest-updated-page">
        <header className="latest-updated-heading"><h1>Latest Updated</h1><p>Recently released indicators and their published changes.</p></header>
        <WeeklyChanges />
      </div>
      : !isDashboardPath(pathname) ? children : null}
  </>;
}
