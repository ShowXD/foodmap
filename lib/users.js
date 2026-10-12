export function adminEmails(env) {
  return String(env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

// Anyone who passes Access gets an account (registration is open); a new user only
// sees their own personal list until added to a group. ADMIN_EMAILS bootstraps the
// site admin so a stranger who happens to log in first can never become admin.
export async function ensureUser(db, email, env) {
  const isListedAdmin = adminEmails(env).includes(email);
  let user = await db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  if (!user) {
    user = await db
      .prepare("INSERT INTO users (email, status, is_admin) VALUES (?, 'approved', ?) ON CONFLICT(email) DO NOTHING RETURNING *")
      .bind(email, isListedAdmin ? 1 : 0)
      .first();
    // A concurrent request may have inserted the row first.
    user ??= await db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  } else if (isListedAdmin && (user.status !== 'approved' || !user.is_admin)) {
    user = await db
      .prepare("UPDATE users SET status = 'approved', is_admin = 1 WHERE id = ? RETURNING *")
      .bind(user.id)
      .first();
  }
  return user;
}
