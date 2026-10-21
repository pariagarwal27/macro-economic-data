import { WeeklyChanges } from "@/components/WeeklyChanges";

export default function LatestUpdatedPage() {
  return <div className="latest-updated-page">
    <header className="latest-updated-heading">
      <h1>Latest Updated</h1>
      <p>Recently released indicators and their published changes.</p>
    </header>
    <WeeklyChanges />
  </div>;
}
