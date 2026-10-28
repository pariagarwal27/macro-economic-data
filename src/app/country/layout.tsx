import { CountryDashboardPanels } from "@/components/CountryDashboardPanels";

export default function CountryLayout({ children }: { children: React.ReactNode }) {
  return <CountryDashboardPanels>{children}</CountryDashboardPanels>;
}
