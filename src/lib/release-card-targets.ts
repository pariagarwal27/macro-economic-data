export type ReleaseCardTarget = { region: "US" | "UK" | "EA"; rootId: string; kind: "inflation" | "pce" | "retail" };
const targets: Array<[ReleaseCardTarget, string[]]> = [
  [{region:"US",rootId:"us-cpi",kind:"inflation"}, ["us-cpi","us-cpi-yoy","us-cpi-mom"]],
  [{region:"US",rootId:"us-cpi-core",kind:"inflation"}, ["us-cpi-core","us-core-cpi-yoy","us-core-cpi-mom"]],
  [{region:"US",rootId:"us-pce",kind:"pce"}, ["us-pce","us-pce-yoy","us-pce-mom"]],
  [{region:"US",rootId:"us-core-pce",kind:"pce"}, ["us-core-pce","us-core-pce-yoy","us-core-pce-mom"]],
  [{region:"UK",rootId:"uk-cpi-yoy",kind:"inflation"}, ["uk-cpi-yoy","uk-cpi-mom"]],
  [{region:"UK",rootId:"uk-cpih-yoy",kind:"inflation"}, ["uk-cpih-yoy","uk-cpih-mom"]],
  [{region:"EA",rootId:"ea-hicp-yoy",kind:"inflation"}, ["ea-hicp-yoy","ea-hicp-mom"]],
  [{region:"EA",rootId:"ea-core-hicp-yoy",kind:"inflation"}, ["ea-core-hicp-yoy","ea-core-hicp-mom"]],
  [{region:"US",rootId:"us-retail-sales-total",kind:"retail"}, ["us-retail-sales-total","us-retail-sales"]],
  [{region:"US",rootId:"us-retail-sales-control-group",kind:"retail"}, ["us-retail-sales-control-group"]],
  [{region:"UK",rootId:"uk-retail-sales-total-ex-fuel",kind:"retail"}, ["uk-retail-sales-total-ex-fuel","uk-retail-sales","uk-retail-sales-mom","uk-retail-sales-total-yoy"]],
  [{region:"UK",rootId:"uk-retail-sales-ex-fuel",kind:"retail"}, ["uk-retail-sales-ex-fuel","uk-retail-sales-ex-fuel-yoy"]],
  [{region:"EA",rootId:"ea-retail-sales-total-ex-motor-vehicles",kind:"retail"}, ["ea-retail-sales-total-ex-motor-vehicles","ea-retail-sales","ea-retail-sales-mom"]],
  [{region:"EA",rootId:"ea-retail-sales-ex-fuel",kind:"retail"}, ["ea-retail-sales-ex-fuel"]],
];
export function releaseCardTarget(id: string): ReleaseCardTarget | null {
  return targets.find(([, aliases]) => aliases.includes(id))?.[0] ?? null;
}
