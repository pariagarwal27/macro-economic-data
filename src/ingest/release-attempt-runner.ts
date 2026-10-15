/** Independent request streams: one active request per metric, no batch barrier. */
export function createReleaseAttemptRunner() {
  const running = new Set<string>();
  return {
    isRunning: (metricId: string) => running.has(metricId),
    async run<T extends { retryEligible: boolean }>(
      metricId: string,
      attempt: () => Promise<T>,
      continueRetrying: () => boolean | Promise<boolean>,
    ): Promise<T | null> {
      if (running.has(metricId)) return null;
      running.add(metricId);
      try {
        let result: T;
        do {
          result = await attempt();
        } while (result.retryEligible && await continueRetrying());
        return result;
      } finally {
        running.delete(metricId);
      }
    },
  };
}
