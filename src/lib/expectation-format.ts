type ExpectationPayload = {
  meta?: {
    unit?: string | null;
  };
};

export function formatExpectationValue(
  payload: ExpectationPayload | undefined,
  value: number | null | undefined,
) {
  if (value == null || !Number.isFinite(value)) return "—";

  const unit = payload?.meta?.unit?.toLowerCase() ?? "";

  if (
    unit.includes("%") ||
    unit.includes("percent") ||
    unit.includes("percentage")
  ) {
    return `${value.toFixed(2)}%`;
  }

  if (unit.includes("basis") || unit.includes("bp")) {
    return `${value > 0 ? "+" : ""}${value.toFixed(1)} bp`;
  }

  return value.toFixed(1);
}
