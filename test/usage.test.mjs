import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestDb } from './d1.mjs';
import { ensureUser } from '../lib/users.js';
import { dayIn, recordUsage, usageReport } from '../lib/usage.js';
import * as usage from '../functions/api/usage.js';
import * as config from '../functions/api/config.js';

// 05:00 UTC on 14 Oct is still 13 Oct in California (PDT), where Google's quota day runs.
const NOW = new Date('2026-10-14T05:00:00Z');

test('each API is counted in the day its provider resets on', () => {
  assert.equal(dayIn('America/Los_Angeles', NOW), '2026-10-13');
  assert.equal(dayIn('UTC', NOW), '2026-10-14');
});

test('report: today, this month and a zero-filled 30-day history per API', async () => {
  const DB = createTestDb();
  await recordUsage(DB, 'places_search', NOW);
  await recordUsage(DB, 'places_search', NOW);
  await recordUsage(DB, 'places_search', new Date('2026-10-02T20:00:00Z'));
  await recordUsage(DB, 'places_search', new Date('2026-09-20T20:00:00Z')); // last month, still within 30 days
  await recordUsage(DB, 'workers_ai', NOW);

  const report = Object.fromEntries((await usageReport(DB, NOW)).map((entry) => [entry.api, entry]));
  const search = report.places_search;
  assert.deepEqual([search.today, search.month, search.daily_limit, search.monthly_free], [2, 3, 100, 5000]);
  assert.equal(search.history.length, 30);
  assert.deepEqual(search.history.at(-1), { day: '2026-10-13', count: 2 });
  assert.equal(search.history[0].day, '2026-09-14');
  assert.equal(search.history.reduce((sum, entry) => sum + entry.count, 0), 4);
  assert.deepEqual([report.workers_ai.today, report.workers_ai.history.at(-1).day], [1, '2026-10-14']);
  assert.equal(report.maps_load.today, 0);
});

test('usage page is for site admins only; opening the map counts one map load', async () => {
  const DB = createTestDb();
  const admin = await ensureUser(DB, 'admin@example.test', { ADMIN_EMAILS: 'admin@example.test' });
  const member = await ensureUser(DB, 'member@example.test', {});
  const get = (handler, user, env = {}) => handler({ request: new Request('https://example.test/api'), env: { DB, ...env }, data: { user } });

  assert.equal((await get(usage.onRequestGet, member)).status, 403);
  await get(config.onRequestGet, member); // no key configured: nothing is loaded, nothing counted
  await get(config.onRequestGet, member, { GOOGLE_MAPS_BROWSER_KEY: 'key', GOOGLE_MAPS_MAP_ID: 'map' });
  const report = await (await get(usage.onRequestGet, admin)).json();
  assert.equal(report.find((entry) => entry.api === 'maps_load').today, 1);
});
