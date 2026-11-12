"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DASHBOARD, type UiNode } from "./macro-ui-hierarchy";
import { InflationReleaseCard } from "./InflationReleaseCard";
import { PceReleaseCard } from "./PceReleaseCard";
import { RetailReleaseCard } from "./RetailReleaseCard";
import { releaseCardTarget } from "@/lib/release-card-targets";
import type { ReleaseMetrics } from "@/lib/release-driver-adapters";

export function MetricReleaseDetail({ id }: { id: string }) {
  const target = releaseCardTarget(id)!;
  const [data, setData] = useState<{region:string; metrics:ReleaseMetrics} | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/dashboard/${target.region}`, {cache:"no-store",signal:controller.signal})
      .then(async response => { if (!response.ok) throw new Error(`Dashboard API ${response.status}`); return response.json() as Promise<ReleaseMetrics>; })
      .then(metrics => { setData({region:target.region,metrics}); setError(null); })
      .catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : String(error)); });
    return () => controller.abort();
  }, [target.region]);
  const metrics = data?.region === target.region ? data.metrics : null;
  const openComponent = (metricId:string) => router.push(`/metrics/${encodeURIComponent(metricId)}`);
  const retailNodes = DASHBOARD[target.region].activity.find(spec => spec.id === `${target.region.toLowerCase()}-retail-sales-card`)?.components ?? [];
  const allPceNodes = DASHBOARD.US.prices.find(spec => spec.id === "us-pce-card")?.components ?? [];
  const core = target.rootId === "us-core-pce";
  const excludeFoodEnergy = (nodes:UiNode[]):UiNode[] => nodes.filter(node => !["us-pce-food","us-pce-energy"].includes(node.metricId ?? "")).map(node => node.metricId === "us-pce-housing-utilities"
    ? {...node,label:"Housing",metricId:"us-pce-housing",children:node.children ? excludeFoodEnergy(node.children) : undefined}
    : {...node,children:node.children ? excludeFoodEnergy(node.children) : undefined});
  return <div className="mx-auto max-w-[1340px] px-4 py-7 sm:px-6">
    <Link href={`/country/${target.region.toLowerCase()}`} className="text-sm text-[var(--accent-ink)] hover:underline">← {target.region} dashboard</Link>
    {error ? <p role="alert" className="release-empty">{error}</p> : !metrics ? <p className="release-empty" role="status">Loading release and component history…</p>
      : target.kind === "inflation" ? <InflationReleaseCard key={target.rootId} metricId={target.rootId} metrics={metrics} onComponentOpen={openComponent} />
        : target.kind === "pce" ? <PceReleaseCard key={target.rootId} rootMetricId={target.rootId} core={core} components={core ? excludeFoodEnergy(allPceNodes) : allPceNodes} metrics={metrics} onComponentOpen={openComponent} />
          : <RetailReleaseCard key={target.rootId} region={target.region} rootMetricId={target.rootId} components={retailNodes} metrics={metrics} onComponentOpen={openComponent} />}
  </div>;
}
