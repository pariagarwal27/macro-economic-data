import { CountryDashboard } from '@/components/CountryDashboard';
export default async function CountryPage({params}:{params:Promise<{region:string}>}){const {region}=await params;return <CountryDashboard region={region.toUpperCase()}/>}
