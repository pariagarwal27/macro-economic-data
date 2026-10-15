import { AsyncLocalStorage } from "node:async_hooks";

const context = new AsyncLocalStorage();

/** @template T @param {() => T} load @returns {T} */
export function withFreshReleaseFetch(load) {
  return context.run(true, load);
}

export function isFreshReleaseFetch() {
  return context.getStore() === true;
}
