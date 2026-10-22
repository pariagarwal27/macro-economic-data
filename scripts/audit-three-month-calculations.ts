import {createClient} from '@libsql/client';
import {writeFileSync} from 'node:fs';
import {METRICS} from '../src/catalog/metrics';
import {buildThreeMonthMethodMap,buildThreeMonthTrend} from '../src/lib/three-month-trend';
async function main(){
const c=createClient({url:'file:data/macro.db'});
const rows=(await c.execute('SELECT id,metric_id,date,value,raw_value FROM observations WHERE is_latest=1 ORDER BY metric_id,date,id')).rows;
const histories=new Map<string,Map<string,any>>();
let duplicates=0;
for(const r of rows){const id=String(r.metric_id); const bucket=histories.get(id)??new Map(); if(bucket.has(String(r.date)))duplicates++;bucket.set(String(r.date),{date:String(r.date),value:Number(r.value),rawValue:r.raw_value==null?null:Number(r.raw_value)});histories.set(id,bucket);}
const get=(id:string)=>[...(histories.get(id)?.values()??[])];
const methods=buildThreeMonthMethodMap(METRICS);
const shift=(s:string,n:number)=>{const [y,m]=s.slice(0,7).split('-').map(Number);return new Date(Date.UTC(y,m-1+n,1)).toISOString().slice(0,7)};
const report:any={generatedAt:new Date().toISOString(),database:'data/macro.db',duplicateLatestRows:duplicates,metrics:[],mismatches:[],unavailable:[]};
let checked=0;
for(const metric of METRICS){const method=methods.get(metric.id);if(!method||method.method==='not-applicable')continue;
const history=get(metric.id);const companionId=method.sourceMetricIds.find(x=>x!==metric.id);const companion=companionId?get(companionId):undefined;
const trend=buildThreeMonthTrend(metric,history,method,companion);
if(!trend?.history.length){report.unavailable.push({id:metric.id,method:method.method,sourceCount:history.length,companionId});continue;}
let mismatches=0;
const input=(method.method==='published-3m3m'||method.method==='published-average'||(metric.transform==='pct_change_yoy'&&method.method==='saar-3m3m'))?companion??[]:history;
const byMonth=new Map(input.map(p=>[p.date.slice(0,7),p]));
for(const p of trend.history){let expected:number|undefined;
if(method.method==='published-3m3m'||method.method==='published-saar')expected=input.find(q=>q.date===p.date)?.value;
else if(method.method==='moving-average'){const w=[-2,-1,0].map(n=>byMonth.get(shift(p.date,n))?.value);if(w.every(x=>x!=null))expected=w.reduce((a,b)=>a!+b!,0)!/3;}
else if(method.method==='published-average')expected=input.find(q=>q.date===p.date)?.value;
else if(method.method==='saar-3m3m'){
const rates=metric.transform==='pct_change_mom'||(metric.transform==='pct_change_yoy'&&companion?.length);
if(rates&&!(metric.source==='bea'&&metric.seriesId.startsWith('T20804:'))&&!(metric.region==='EA'&&metric.category==='growth')){const w=[-2,-1,0].map(n=>byMonth.get(shift(p.date,n))?.value);if(w.every(x=>x!=null))expected=100*Math.expm1(4*w.reduce((a,b)=>a+Math.log1p(b!/100),0));}
else {const a=byMonth.get(shift(p.date,0)),b=byMonth.get(shift(p.date,-3));if(a&&b)expected=100*Math.expm1(4*Math.log((a.rawValue??a.value)/(b.rawValue??b.value)));}}
if(expected!==undefined){checked++;if(Math.abs(expected-p.value)>1e-8){mismatches++;report.mismatches.push({id:metric.id,date:p.date,actual:p.value,expected});}}
}
report.metrics.push({id:metric.id,region:metric.region,method:method.method,label:method.label,sourceCount:history.length,derivedCount:trend.history.length,first:trend.history[0],latest:trend.history.at(-1),mismatches,companionId});
}
report.checkedValues=checked;
writeFileSync('data/three-month-calculation-audit.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({checkedValues:checked,metrics:report.metrics.length,mismatches:report.mismatches.length,duplicateLatestRows:duplicates,unavailable:report.unavailable.length,keyReadings:report.metrics.filter((x:any)=>['us-participation','us-atlanta-bie-1y','us-cpi','us-core-pce','us-pce','ea-retail-sales-ex-fuel','uk-cpi-yoy'].includes(x.id))},null,2));
c.close();

}
main().catch(error=>{console.error(error);process.exitCode=1;});
