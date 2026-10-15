// Our own count of calls to outside APIs, so the admin page can show what's left of each quota.
// Daily limits mirror the quotas set in Google Cloud (docs/setup/google.md step 5); keep them in sync.
// Google resets quotas at midnight Pacific time, Workers AI at 00:00 UTC, so each API is counted in its own day.
const PACIFIC = 'America/Los_Angeles';
const HISTORY_DAYS = 30;

// perUserDaily keeps any one person (friends included) from using up the shared daily quota;
// null = no per-person limit (coordinate refreshes run in the background for everyone).
export const APIS = {
  maps_load: { label: 'Google 地圖載入', timeZone: PACIFIC, dailyLimit: 300, monthlyFree: 10000, perUserDaily: 30 },
  places_search: { label: 'Google 地點搜尋', timeZone: PACIFIC, dailyLimit: 100, monthlyFree: 5000, perUserDaily: 20 },
  place_details: { label: 'Google 座標更新', timeZone: PACIFIC, dailyLimit: 30, monthlyFree: 10000, perUserDaily: null },
  // Free tier is 10,000 neurons a day; one extraction is roughly 70, so this is an estimate.
  workers_ai: { label: 'AI 擷取（Workers AI）', timeZone: 'UTC', dailyLimit: 140, monthlyFree: null, perUserDaily: 30 },
};
// Per-person daily caps on things that only cost storage, not an outside API, so they are not on the
// usage page. With sign-up open to any Google account, they keep one account from filling the database.
export const STORAGE_LIMITS = {
  place_saves: { timeZone: 'UTC', perUserDaily: 300 },
  thumbnails: { timeZone: 'UTC', perUserDaily: 300 },
};
const limitOf = (api) => APIS[api] ?? STORAGE_LIMITS[api];
const TOP_USERS = 5;

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

/**
 * Counts one call for this person and says whether it is allowed. At the limit nothing is counted,
 * so the numbers shown on the admin page are calls actually made.
 */
export async function takeUserQuota(db, userId, api, now = new Date()) {
  const row = await db
    .prepare(
      `INSERT INTO user_daily_usage (user_id, api, day, count) VALUES (?1, ?2, ?3, 1)
       ON CONFLICT (user_id, api, day) DO UPDATE SET count = count + 1 WHERE count < ?4
       RETURNING count`,
    )
    .bind(userId, api, dayIn(limitOf(api).timeZone, now), limitOf(api).perUserDaily)
    .first();
  return Boolean(row);
}

async function topUsersToday(db, api, day) {
  const { results } = await db
    .prepare(
      `SELECT COALESCE(u.display_name, u.email) AS name, d.count
       FROM user_daily_usage d JOIN users u ON u.id = d.user_id
       WHERE d.api = ? AND d.day = ? ORDER BY d.count DESC LIMIT ${TOP_USERS}`,
    )
    .bind(api, day)
    .all();
  return results;
}

/** Today, this month and the last 30 days for every API, with zero-filled gaps for the chart. */
export async function usageReport(db, now = new Date()) {
  const todays = Object.fromEntries(Object.entries(APIS).map(([api, { timeZone }]) => [api, dayIn(timeZone, now)]));
  const firstDays = Object.values(todays).flatMap((today) => [daysBefore(today, HISTORY_DAYS - 1), `${today.slice(0, 7)}-01`]);
  const earliest = firstDays.reduce((earlier, day) => (day < earlier ? day : earlier), firstDays[0]); // YYYY-MM-DD compares as text
  const { results } = await db.prepare('SELECT api, day, count FROM api_usage WHERE day >= ?').bind(earliest).all();

  return Promise.all(Object.entries(APIS).map(async ([api, { label, dailyLimit, monthlyFree, perUserDaily }]) => {
    const today = todays[api];
    const counts = new Map(results.filter((row) => row.api === api).map((row) => [row.day, row.count]));
    const month = [...counts].filter(([day]) => day.startsWith(today.slice(0, 7))).reduce((sum, [, count]) => sum + count, 0);
    const history = Array.from({ length: HISTORY_DAYS }, (_, index) => {
      const day = daysBefore(today, HISTORY_DAYS - 1 - index);
      return { day, count: counts.get(day) ?? 0 };
    });
    const topUsers = perUserDaily ? await topUsersToday(db, api, today) : [];
    return {
      api, label, daily_limit: dailyLimit, monthly_free: monthlyFree, per_user_daily: perUserDaily,
      today: counts.get(today) ?? 0, month, history, top_users: topUsers,
    };
  }));
}
