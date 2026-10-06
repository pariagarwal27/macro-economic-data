import { inflateRawSync } from "node:zlib";

const SAFE_ZIP = "https://www.ecb.europa.eu/stats/pdf/surveys/sme/SAFE_main_series.zip";

function findEOCD(buf: Buffer) {
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  throw new Error("EOCD not found");
}
function listZip(buf: Buffer) {
  const e = findEOCD(buf); const n = buf.readUInt16LE(e+10); let off=buf.readUInt32LE(e+16); const out:string[]=[];
  for(let i=0;i<n;i++){ if(buf.readUInt32LE(off)!==0x02014b50) throw new Error("bad central dir"); const nl=buf.readUInt16LE(off+28), ex=buf.readUInt16LE(off+30), co=buf.readUInt16LE(off+32); out.push(buf.subarray(off+46,off+46+nl).toString("utf8")); off += 46+nl+ex+co; }
  return out;
}
function readZip(buf:Buffer, entry:string){
  const e=findEOCD(buf); const n=buf.readUInt16LE(e+10); let off=buf.readUInt32LE(e+16);
  for(let i=0;i<n;i++){ const nl=buf.readUInt16LE(off+28), ex=buf.readUInt16LE(off+30), co=buf.readUInt16LE(off+32); const name=buf.subarray(off+46,off+46+nl).toString("utf8"); if(name===entry){ const method=buf.readUInt16LE(off+10), size=buf.readUInt32LE(off+20), lo=buf.readUInt32LE(off+42); const ln=buf.readUInt16LE(lo+26), le=buf.readUInt16LE(lo+28); const data=buf.subarray(lo+30+ln+le,lo+30+ln+le+size); return method===0?Buffer.from(data):method===8?inflateRawSync(data):(()=>{throw new Error("unsupported compression")})(); } off+=46+nl+ex+co; }
  throw new Error(`missing ${entry}`);
}
function xmlDecode(s:string){return s.replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;/g,"'");}
function col(s:string){let n=0; for(const c of s)n=n*26+c.charCodeAt(0)-64; return n-1;}
function parseShared(xml:string){const out:string[]=[]; for(const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)){out.push([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x=>xmlDecode(x[1])).join(""));} return out;}
function rows(xml:string, shared:string[]){const out:any[]=[]; for(const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)){const cells:any={}; for(const cm of rm[1].matchAll(/<c\b[^>]*\br="([A-Z]+)(\d+)"([^>]*)>([\s\S]*?)<\/c>/g)){const a=cm[3], inner=cm[4]; let v=xmlDecode(inner.match(/<v>([\s\S]*?)<\/v>/)?.[1]??""); const t=a.match(/(?:^|\s)t="([^"]+)"/)?.[1]; if(t==="s") v=shared[Number(v)]??""; if(t==="inlineStr") v=xmlDecode(inner.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1]??""); cells[col(cm[1])]=v;} if(Object.keys(cells).length) out.push({n:Number(rm[0].match(/\br="(\d+)"/)?.[1]??0),cells});} return out;}
function fmt(cells:any){return Object.entries(cells).map(([k,v])=>`${String.fromCharCode(65+Number(k))}=${String(v)}`).join(" | ");}

async function main() {
const res=await fetch(SAFE_ZIP,{headers:{"User-Agent":"macro-safe-debug/1.0","Accept":"*/*"}}); if(!res.ok) throw new Error(`ECB download ${res.status}`); const outer=Buffer.from(await res.arrayBuffer());
const xlsxName=listZip(outer).find(x=>/\.xlsx$/i.test(x)); if(!xlsxName) throw new Error("No xlsx in SAFE zip"); const xlsx=readZip(outer,xlsxName); const shared=parseShared(readZip(xlsx,"xl/sharedStrings.xml").toString("utf8"));
const sheets=listZip(xlsx).filter(x=>/^xl\/worksheets\/sheet\d+\.xml$/i.test(x));
console.log(`Workbook: ${xlsxName}`); console.log(`Sheets: ${sheets.length}`);
for(const sheet of sheets){let rs:any[]; try{rs=rows(readZip(xlsx,sheet).toString("utf8"),shared);}catch{continue;} const hits=rs.filter(r=>/selling\s*prices?|wage\s*costs?|non[- ]labou?r\s*input|input\s*cost/i.test(Object.values(r.cells).join(" "))); if(!hits.length) continue;
 console.log(`\n=== ${sheet} ===`); console.log("HEADER MATCHES:"); for(const r of hits.slice(0,20)) console.log(`row ${r.n}: ${fmt(r.cells)}`);
 const dateRows=rs.filter(r=>Object.values(r.cells).some(v=>/^202[4-6]-(0[1-9]|1[0-2])/.test(String(v))) || Object.values(r.cells).some(v=>{const x=Number(v);return Number.isFinite(x)&&x>45000&&x<47000;}));
 console.log(`DATE-LIKE ROWS: ${dateRows.length}`); for(const r of dateRows.slice(-15)) console.log(`row ${r.n}: ${fmt(r.cells)}`);
}

}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
