import assert from 'node:assert/strict';
import test from 'node:test';
import { getClientJsonCache, prefetchClientJson, refreshClientJson } from './client-json-cache';

const stored = new Map<string, string>();
Object.defineProperty(globalThis, 'window', { configurable: true, value: {
  sessionStorage: {
    get length() { return stored.size; },
    key: (index: number) => [...stored.keys()][index] ?? null,
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value); },
    removeItem: (key: string) => { stored.delete(key); },
  },
} });

test('restores a saved dashboard immediately after the in-memory cache is lost', () => {
  stored.set('macrohub:json:v1:dashboard:RESTORED', JSON.stringify({ savedAt: Date.now(), payload: { observations: [1, 2, 3] } }));
  assert.deepEqual(getClientJsonCache('dashboard:RESTORED'), { observations: [1, 2, 3] });
});

test('does not restore expired or damaged snapshots', () => {
  stored.set('macrohub:json:v1:expired', JSON.stringify({ savedAt: 0, payload: { stale: true } }));
  stored.set('macrohub:json:v1:broken', '{');
  assert.equal(getClientJsonCache('expired'), undefined);
  assert.equal(getClientJsonCache('broken'), undefined);
});

test('leaves saved snapshots out of the initial server hydration render', () => {
  stored.set('macrohub:json:v1:hydrate', JSON.stringify({ savedAt: Date.now(), payload: { value: 9 } }));
  assert.equal(getClientJsonCache('hydrate', false), undefined);
  assert.deepEqual(getClientJsonCache('hydrate'), { value: 9 });
});

test('preloading reuses recent data instead of downloading histories on every pointer move', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ value: 12 }); };
  await prefetchClientJson('preloaded', '/test');
  await prefetchClientJson('preloaded', '/test');
  assert.equal(calls, 1);
  assert.deepEqual(getClientJsonCache('preloaded'), { value: 12 });
});

test('concurrent refreshes share one request and failed refreshes keep the last data', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ value: 42 }); };
  const [a, b] = await Promise.all([refreshClientJson('shared', '/test'), refreshClientJson('shared', '/test')]);
  assert.deepEqual(a, b);
  assert.equal(calls, 1);
  globalThis.fetch = async () => new Response(null, { status: 500 });
  await assert.rejects(refreshClientJson('shared', '/test'));
  assert.deepEqual(getClientJsonCache('shared'), { value: 42 });
});

test('blocked browser storage does not prevent dashboard loading', async () => {
  Object.defineProperty(window, 'sessionStorage', { get() { throw new Error('Storage blocked'); } });
  globalThis.fetch = async () => Response.json({ value: 7 });
  await refreshClientJson('blocked-storage', '/test');
  assert.deepEqual(getClientJsonCache('blocked-storage'), { value: 7 });
});
