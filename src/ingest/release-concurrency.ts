export async function mapConcurrent<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("concurrency must be a positive integer");
  }

  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(items.length, concurrency);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = nextIndex++;
        if (index >= items.length) return;
        results[index] = await mapper(items[index], index);
      }
    })
  );

  return results;
}
