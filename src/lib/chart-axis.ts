/** Build rounded, unique tick values for chart axes. */
export function getNiceTicks(values: number[], target = 5, minimumStep = 0.1): number[] {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return [];

  let min = Math.min(...finite);
  let max = Math.max(...finite);
  if (min === max) {
    min -= Math.max(Math.abs(min) * 0.05, minimumStep);
    max += Math.max(Math.abs(max) * 0.05, minimumStep);
  }

  const roughStep = Math.max((max - min) / Math.max(1, target - 1), minimumStep);
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalized = roughStep / magnitude;
  const factor = [1, 2, 2.5, 5, 10].find(candidate => candidate >= normalized) ?? 10;
  const step = Math.max(factor * magnitude, minimumStep);
  const first = Math.floor(min / step) * step;
  const last = Math.ceil(max / step) * step;
  const precision = Math.min(8, Math.max(0, Math.ceil(-Math.log10(step)) + 1));
  const ticks: number[] = [];

  for (let value = first, count = 0; value <= last + step * 1e-8 && count < 16; value += step, count++) {
    ticks.push(Number(value.toFixed(precision)));
  }
  return ticks;
}

export function getNiceTickDomain(ticks: number[]): [number, number] {
  return [ticks[0] ?? 0, ticks.at(-1) ?? 1];
}
