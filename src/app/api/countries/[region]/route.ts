import { NextResponse } from 'next/server';
import { getSeriesHistory } from '@/data/dashboard';
import { HEADLINE_IDS, KEY_INDICATOR_IDS, COUNTRY_META, type Region } from '@/catalog/hierarchy';
export const dynamic='force-dynamic'; export const runtime='nodejs';
export async function GET(_req:Request,ctx:{params:Promise<{region:string}>}){const {region:raw}=await ctx.params;const region=raw.toUpperCase() as Region;if(!['US','UK','EA'].includes(region))return NextResponse.json({error:'Unknown region'},{status:404});const categories:Record<string,unknown>={};const keyRows=[];for(const id of KEY_INDICATOR_IDS[region]){const s=await getSeriesHistory(id,240);if(!s)continue;const latest=s.history.at(-1)??null,prior=s.history.at(-2)??null;keyRows.push({...s.meta,latest,prior,delta:latest&&prior?latest.value-prior.value:null,history:s.history.filter((x:{date:string;value:number})=>x.date.startsWith(String(new Date().getUTCFullYear())))})}for(const category of ['inflation','growth','jobs'] as const){const rows=[];for(const id of HEADLINE_IDS[region][category]){const s=await getSeriesHistory(id,240);if(!s)continue;const latest=s.history.at(-1)??null,prior=s.history.at(-2)??null;rows.push({...s.meta,latest,prior,delta:latest&&prior?latest.value-prior.value:null,history:s.history.filter((x:{date:string;value:number})=>x.date.startsWith(String(new Date().getUTCFullYear())))})}categories[category]=rows}return NextResponse.json({region,meta:COUNTRY_META[region],keyIndicators:keyRows,categories},{headers:{'Cache-Control':'no-store'}})}



