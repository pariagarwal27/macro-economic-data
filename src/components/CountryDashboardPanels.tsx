"use client";

import { memo, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { CountryDashboard } from "./CountryDashboard";

const CountryPanel = memo(CountryDashboard);

/** Preserve chart state and layout when switching between visited countries. */
export function CountryDashboardPanels({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const current = /^\/country\/(us|uk|ea)\/?$/i.exec(pathname)?.[1]?.toUpperCase();
  const [visited, setVisited] = useState<string[]>([]);
  const regions = current && !visited.includes(current) ? [...visited, current] : visited;

  useEffect(() => {
    if (current) setVisited(previous => previous.includes(current) ? previous : [...previous, current]);
  }, [current]);

  return <>
    {regions.map(region => <div key={region} aria-hidden={region !== current} inert={region !== current}
      style={region === current ? undefined : { position: "fixed", inset: 0, visibility: "hidden", pointerEvents: "none", zIndex: -1, overflow: "hidden" }}>
      <CountryPanel region={region} active={region === current} />
    </div>)}
    {children}
  </>;
}
