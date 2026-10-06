import * as XLSX from "xlsx";
import * as cheerio from "cheerio";
import type { RawPoint } from "./transforms";

const DATASET_PAGE = "https://www.ons.gov.uk/employmentandlabourmarket/peopleinwork/earningsandworkinghours/datasets/realtimeinformationstatisticsreferencetableseasonallyadjusted/current";
let cachedXlsx: { url:string; buf:Buffer; at:number } | null = null;
const CACHE_MS = 15*60*1000;

async function fetchOnspayeEmploymentLevel(): Promise<RawPoint[]> {
  const rows = await extractPaye("employment");

  return rows
    .filter((x): x is typeof x & { level: number } =>
      typeof x.level === "number" && Number.isFinite(x.level)
    )
    .map(x => ({
      date: x.date,
      value: x.level / 1000,
    }))
    .sort(sortPoints);

}

export async function fetchOnsPayeEmploymentChange(): Promise<RawPoint[]> {
  const rows = await extractPaye("employment");
  return rows.filter(x=>x.change!=null).map(x=>({date:x.date,value:x.change!/1000})).sort(sortPoints);
}
export async function fetchOnsPayeEmploymentLevel(): Promise<RawPoint[]> {
  const rows = await extractPaye("employment");

  return rows
    .flatMap((x) => {
      if (typeof x.level !== "number" || !Number.isFinite(x.level)) {
        return [];
      }

      return [
        {
          date: x.date,
          value: x.level / 1000,
        },
      ];
    })
    .sort(sortPoints);
}

export async function fetchOnsPayeMedianPayLevel(): Promise<RawPoint[]> {
  const rows = await extractPaye("pay");
  return rows.filter(x=>x.pay!=null).map(x=>({date:x.date,value:x.pay!})).sort(sortPoints);
}

async function loadPayeXlsx(): Promise<Buffer> {
  const now=Date.now();
  if(cachedXlsx && now-cachedXlsx.at<CACHE_MS) return cachedXlsx.buf;
  const url=await resolveLatestPayeXlsxUrl();
  const res=await fetch(url,{headers:{Accept:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","User-Agent":"macro-economy-tracker/1.0"},cache:"no-store"});
  if(!res.ok) throw new Error(`ONS PAYE xlsx ${res.status}`);
  const buf=Buffer.from(await res.arrayBuffer());
  if(buf.length<4 || buf[0]!==0x50 || buf[1]!==0x4b) throw new Error("ONS PAYE response was not an XLSX workbook");
  cachedXlsx={url,buf,at:now}; return buf;
}

type Row={date:string;level?:number;change?:number;pay?:number};

async function extractPaye(kind:"employment"|"pay"):Promise<Row[]> {
  const wb=XLSX.read(await loadPayeXlsx(),{type:"buffer",cellDates:true,cellNF:false});
  const candidates: Array<{score:number; rows: Row[]}> = [];
  for(const name of wb.SheetNames){
    const ws=wb.Sheets[name]; if(!ws) continue;
    const rows=XLSX.utils.sheet_to_json<unknown[]>(ws,{header:1,raw:true,defval:null});
    for(let h=0;h<Math.min(rows.length,80);h++){
      const header=(rows[h]??[]).map(v=>norm(v));
      const dateCol=header.findIndex(v=>/^(month|date|period|time)$/.test(v)||v.includes("month"));
      if(dateCol<0) continue;
      const levelCol=header.findIndex(v=>v.includes("payrolled")&&v.includes("employee")&&!v.includes("change")&&(/level|total|number|000|thousand|employee/.test(v)));
      const changeCol=header.findIndex(v=>v.includes("change")&&v.includes("payrolled"));
      const payCol=header.findIndex(v=>v.includes("median")&&v.includes("pay"));
      let score=0;
      if(kind==="employment" && levelCol>=0) score+=5;
      if(kind==="employment" && changeCol>=0) score+=3;
      if(kind==="pay" && payCol>=0) score+=6;
      if(!score) continue;
      const out:Row[]=[];
      for(let r=h+1;r<rows.length;r++){
        const row=rows[r]??[]; const date=monthToDate(row[dateCol]); if(!date) continue;
        const level=levelCol>=0?num(row[levelCol]):undefined; const change=changeCol>=0?num(row[changeCol]):undefined; const pay=payCol>=0?num(row[payCol]):undefined;
        if(level==null&&change==null&&pay==null) continue; out.push({date,level,change,pay});
      }
      if(out.length) candidates.push({score:score+Math.min(out.length/100,5),rows:out});
    }
  }
  candidates.sort((a,b)=>b.score-a.score);
  const best=candidates[0]?.rows??[];
  if(!best.length) throw new Error(`ONS PAYE ${kind} table not found in current workbook`);
  return dedupe(best);
}

async function resolveLatestPayeXlsxUrl():Promise<string>{
  const res=await fetch(DATASET_PAGE,{headers:{Accept:"text/html","User-Agent":"macro-economy-tracker/1.0"},cache:"no-store"});
  if(!res.ok) throw new Error(`ONS PAYE dataset page ${res.status}`);
  const html=await res.text(); const $=cheerio.load(html);
  const urls:string[]=[];
  $("a[href]").each((_,el)=>{const h=$(el).attr("href")??""; if(/\.xlsx(?:[?#]|$)/i.test(h)&&/rtisa/i.test(h)) urls.push(h.startsWith("http")?h:`https://www.ons.gov.uk${h}`);});
  const m=html.match(/(?:href|data-url)=["']([^"']*rtisa[^"']+\.xlsx(?:[^"']*)?)["']/i); if(m) urls.push(m[1]!.startsWith("http")?m[1]!:`https://www.ons.gov.uk${m[1]!}`);
  const unique=[...new Set(urls)]; if(!unique.length) throw new Error("ONS PAYE xlsx link not found on dataset page");
  return unique[0]!;
}

function norm(v:unknown):string{return String(v??"").trim().toLowerCase().replace(/\s+/g," ");}
function num(v:unknown):number|undefined{if(typeof v==="number"&&Number.isFinite(v))return v; const n=Number(String(v??"").replace(/,/g,"")); return Number.isFinite(n)?n:undefined;}
function monthToDate(v:unknown):string|null{
  if(v instanceof Date && !Number.isNaN(v.getTime())) return `${v.getUTCFullYear()}-${String(v.getUTCMonth()+1).padStart(2,"0")}-01`;
  const s=String(v??"").trim(); const m=s.match(/^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})$/i);
  if(!m) return null; const months={january:"01",february:"02",march:"03",april:"04",may:"05",june:"06",july:"07",august:"08",september:"09",october:"10",november:"11",december:"12"} as Record<string,string>; return `${m[2]}-${months[m[1]!.toLowerCase()]}-01`;
}
function dedupe(rows:Row[]):Row[]{const m=new Map<string,Row>(); for(const r of rows)m.set(r.date,r); return [...m.values()].sort((a,b)=>a.date.localeCompare(b.date));}
function sortPoints(a:RawPoint,b:RawPoint){return a.date.localeCompare(b.date);}
