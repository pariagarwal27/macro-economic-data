export default async function CountryPage({ params }: { params: Promise<{ region: string }> }) {
  const { region } = await params;
  return ["US", "UK", "EA"].includes(region.toUpperCase()) ? null : <div className="p-10">Unknown country.</div>;
}
