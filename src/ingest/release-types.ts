export type ScheduledRelease = {
  metricId: string;
  metricName: string | null;
  scheduledAt: string;
  scheduledDate: string;
  forecast: number | null;
  previous: number | null;
  status: string | null;
};

export type NormalizedRelease = {
  metricId: string;
  periodDate: string;
  value: number;
  rawValue?: string | null;
  releasedAt: string;
  vintageDate?: string | null;
  supportingDocUrl?: string | null;
  notes?: string | null;
};
