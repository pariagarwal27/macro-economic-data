import { CountryDashboard } from '@/components/CountryDashboard';
export default async function CountryPage({params}:{params:Promise<{region:string}>}){const {region}=await params;const normalizedRegion=region.toUpperCase();return <CountryDashboard key={normalizedRegion} region={normalizedRegion}/>}
