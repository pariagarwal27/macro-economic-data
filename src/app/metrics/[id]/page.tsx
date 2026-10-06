import { MetricDetail } from "@/components/MetricDetail";

export default async function MetricPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <MetricDetail id={id} />;
}
