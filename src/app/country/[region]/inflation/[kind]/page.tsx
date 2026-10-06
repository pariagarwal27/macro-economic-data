import { ComponentExplorer } from '@/components/ComponentExplorer';
export default async function Page({params}:{params:Promise<{region:string;kind:string}>}){const p=await params;return <ComponentExplorer region={p.region.toUpperCase()} kind={p.kind.toUpperCase()}/>}
