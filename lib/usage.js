// Our own count of calls to outside APIs, so the admin page can show what's left of each quota.
// Daily limits mirror the quotas set in Google Cloud (docs/setup/google.md step 5); keep them in sync.
// Google resets quotas at midnight Pacific time, Workers AI at 00:00 UTC, so each API is counted in its own day.
const PACIFIC = 'America/Los_Angeles';
const HISTORY_DAYS = 30;

export const APIS = {
  maps_load: { label: 'Google 地圖載入', timeZone: PACIFIC, dailyLimit: 300, monthlyFree: 10000 },
  places_search: { label: 'Google 地點搜尋', timeZone: PACIFIC, dailyLimit: 100, monthlyFree: 5000 },
  place_details: { label: 'Google 座標更新', timeZone: PACIFIC, dailyLimit: 30, monthlyFree: 10000 },
  // Free tier is 10,000 neurons a day; one extraction is roughly 70, so this is an estimate.
  workers_ai: { label: 'AI 擷取（Workers AI）', timeZone: 'UTC', dailyLimit: 140, monthlyFree: null },
};

/** YYYY-MM-DD in the given timezone. */
export const dayIn = (timeZone, now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

function daysBefore(day, count) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - count);
  return date.toISOString().slice(0, 10);
}

export async function recordUsage(db, api, now = new Date()) {
  await db
    .prepare('INSERT INTO api_usage (api, day, count) VALUES (?, ?, 1) ON CONFLICT (api, day) DO UPDATE SET count = count + 1')
    .bind(api, dayIn(APIS[api].timeZone, now))
    .run();
}

/** Today, this month and the last 30 days for every API, with zero-filled gaps for the chart. */
export async function usageReport(db, now = new Date()) {
  const todays = Object.fromEntries(Object.entries(APIS).map(([api, { timeZone }]) => [api, dayIn(timeZone, now)]));
  const earliest = Object.values(todays)
    .flatMap((today) => [daysBefore(today, HISTORY_DAYS - 1), `${today.slice(0, 7)}-01`])
    .sort()[0];
  const { results } = await db.prepare('SELECT api, day, count FROM api_usage WHERE day >= ?').bind(earliest).all();

  return Object.entries(APIS).map(([api, { label, dailyLimit, monthlyFree }]) => {
    const today = todays[api];
    const counts = new Map(results.filter((row) => row.api === api).map((row) => [row.day, row.count]));
    const month = [...counts].filter(([day]) => day.startsWith(today.slice(0, 7))).reduce((sum, [, count]) => sum + count, 0);
    const history = Array.from({ length: HISTORY_DAYS }, (_, index) => {
      const day = daysBefore(today, HISTORY_DAYS - 1 - index);
      return { day, count: counts.get(day) ?? 0 };
    });
    return { api, label, daily_limit: dailyLimit, monthly_free: monthlyFree, today: counts.get(today) ?? 0, month, history };
  });
}
