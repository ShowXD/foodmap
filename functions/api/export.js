import { findAccessibleList } from '../../lib/lists.js';

const COLUMNS = [
  ['name', '店名'], ['dishes', '食物'], ['area', '地區'], ['address', '地址'], ['tags', '標籤'], ['note', '備註'],
  ['url', '影片連結'], ['source', '來源'], ['created_at', '新增時間(UTC)'],
  ['my_visited_at', '我吃過(UTC)'], ['my_rating', '我的評分'], ['my_note', '我的心得'], ['starred', '想吃'],
];

// Quotes every cell; a leading = + - @ is prefixed with ' so spreadsheets don't run it as a formula.
export function toCsvCell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export async function onRequestGet({ request, env, data }) {
  const list = await findAccessibleList(env.DB, data.user, Number(new URL(request.url).searchParams.get('list')));
  if (!list) return Response.json({ error: 'list not found' }, { status: 404 });
  const { results } = await env.DB
    .prepare(
      `SELECT p.*, v.visited_at AS my_visited_at, v.rating AS my_rating, v.note AS my_note,
              CASE WHEN s.user_id IS NULL THEN '' ELSE '★' END AS starred
       FROM places p
       LEFT JOIN place_visits v ON v.place_id = p.id AND v.user_id = ?2
       LEFT JOIN place_stars s ON s.place_id = p.id AND s.user_id = ?2
       WHERE p.list_id = ?1 ORDER BY p.created_at, p.id`,
    )
    .bind(list.id, data.user.id)
    .all();

  const lines = [COLUMNS.map(([, header]) => toCsvCell(header)).join(',')];
  for (const row of results) lines.push(COLUMNS.map(([key]) => toCsvCell(row[key])).join(','));
  // The BOM makes Excel open the UTF-8 file with Chinese intact.
  const csv = `﻿${lines.join('\r\n')}\r\n`;
  const filename = encodeURIComponent(`美食地圖-${list.name}-${new Date().toISOString().slice(0, 10)}.csv`);
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename*=UTF-8''${filename}`,
    },
  });
}
