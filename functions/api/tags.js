import { findAccessibleList } from '../../lib/lists.js';
import { normalizeTags } from '../../lib/ai.js';

const json = (body, status = 200) => Response.json(body, { status });

/**
 * PUT {list_id, from, to}: renames a tag on every place in the list. A `to` the list already uses merges
 * the two; an empty `to` removes the tag. Any member may tidy tags, as any member may edit a place.
 */
export async function onRequestPut({ request, env, data }) {
  const body = await request.json().catch(() => null);
  const list = await findAccessibleList(env.DB, data.user, body?.list_id);
  if (!list) return json({ error: 'list not found' }, 404);
  const from = normalizeTags(body.from);
  const to = normalizeTags(body.to);
  if (!from || from.includes(' ')) return json({ error: '請選一個標籤' }, 400);
  if (to.includes(' ') || to.length > 30) return json({ error: '新名稱只能是一個標籤（30 字內），不能有空白或 #' }, 400);

  // LIKE only narrows the read; the exact word match happens below.
  const { results } = await env.DB
    .prepare("SELECT id, tags FROM places WHERE list_id = ? AND tags LIKE '%' || ? || '%'")
    .bind(list.id, from)
    .all();
  const changed = results
    .map((place) => {
      const tags = normalizeTags(place.tags).split(' ');
      if (!tags.includes(from)) return null;
      return { id: place.id, tags: normalizeTags(tags.map((tag) => (tag === from ? to : tag)).join(' ')) };
    })
    .filter(Boolean);
  if (changed.length) {
    await env.DB.batch(changed.map(({ id, tags }) => env.DB.prepare('UPDATE places SET tags = ? WHERE id = ?').bind(tags, id)));
  }
  return json({ updated: changed.length });
}
