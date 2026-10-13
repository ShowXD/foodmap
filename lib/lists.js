// Access rules:
// - personal list: only its owner (site admins too are kept out, it is private)
// - group list: its members, plus site admins (they create groups and assign owners)

export const PERSONAL_LIST_NAME = '我的清單';

export async function ensurePersonalList(db, user) {
  await db
    .prepare('INSERT INTO lists (name, owner_user_id, is_personal) VALUES (?1, ?2, 1) ON CONFLICT DO NOTHING')
    .bind(PERSONAL_LIST_NAME, user.id)
    .run();
}

export async function accessibleLists(db, user) {
  const { results } = await db
    .prepare(
      `SELECT l.id, l.name, l.is_personal,
              CASE WHEN l.is_personal = 1 OR m.is_owner = 1 THEN 1 ELSE 0 END AS is_owner,
              CASE WHEN m.user_id IS NOT NULL OR l.is_personal = 1 THEN 1 ELSE 0 END AS is_member
       FROM lists l
       LEFT JOIN list_members m ON m.list_id = l.id AND m.user_id = ?1
       WHERE (l.is_personal = 1 AND l.owner_user_id = ?1)
          OR m.user_id IS NOT NULL
          OR (?2 = 1 AND l.is_personal = 0)
       ORDER BY l.is_personal DESC, l.name`,
    )
    .bind(user.id, user.is_admin ? 1 : 0)
    .all();
  return results;
}

/** Returns the list row the user may use, or null. */
export async function findAccessibleList(db, user, listId) {
  if (!Number.isInteger(listId)) return null;
  return db
    .prepare(
      `SELECT l.id, l.name, l.is_personal,
              CASE WHEN l.is_personal = 1 OR m.is_owner = 1 THEN 1 ELSE 0 END AS is_owner
       FROM lists l
       LEFT JOIN list_members m ON m.list_id = l.id AND m.user_id = ?1
       WHERE l.id = ?3
         AND ((l.is_personal = 1 AND l.owner_user_id = ?1)
              OR m.user_id IS NOT NULL
              OR (?2 = 1 AND l.is_personal = 0))`,
    )
    .bind(user.id, user.is_admin ? 1 : 0, listId)
    .first();
}

/** Returns { id, list_id } for a place in a list the user may use, or null (so ids don't leak). */
export async function findAccessiblePlace(db, user, placeId) {
  if (!Number.isInteger(placeId)) return null;
  const place = await db.prepare('SELECT id, list_id FROM places WHERE id = ?').bind(placeId).first();
  if (!place || !(await findAccessibleList(db, user, place.list_id))) return null;
  return place;
}

/** Group owners and site admins may manage a group's members; personal lists have none. */
export async function findManageableGroup(db, user, listId) {
  const list = await findAccessibleList(db, user, listId);
  if (!list || list.is_personal) return null;
  return list.is_owner || user.is_admin ? list : null;
}
