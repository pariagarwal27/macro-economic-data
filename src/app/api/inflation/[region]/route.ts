import {NextResponse}from'next/server';import{getSeriesHistory}from'@/data/dashboard';import{INFLATION_TREES,type Node, type Region,US_PCE_TREE}from'@/catalog/hierarchy';
function flatten(nodes:Node[],out:Node[]=[]){for(const n of nodes){out.push(n);if(n.children)flatten(n.children,out)}return out}
export const dynamic='force-dynamic';export const runtime='nodejs';export async function GET(req:Request,ctx:{params:Promise<{region:string}>}){const{region:raw}=await ctx.params;const region=raw.toUpperCase() as Region;const kind=new URL(req.url).searchParams.get('kind')?.toUpperCase()??'CPI';if(!['US','UK','EA'].includes(region))return NextResponse.json({error:'Unknown region'},{status:404});const tree=region==='US'&&kind==='PCE'?US_PCE_TREE:INFLATION_TREES[region];const rows=[];for(const n of flatten(tree)){if(!n.metricId) {rows.push({...n,metric:null});continue}const s=await getSeriesHistory(n.metricId,120);const h=s?.history??[];const latest=h.at(-1),prev=h.at(-2);rows.push({...n,metric:s?{...s.meta,latest,prev,delta:latest&&prev?latest.value-prev.value:null,history:h}:null})}return NextResponse.json({region,kind,rows},{headers:{'Cache-Control':'no-store'}})}




