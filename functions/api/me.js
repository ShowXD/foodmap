export function onRequestGet({ data }) {
  const { email, status, is_admin: isAdmin } = data.user;
  return Response.json({ email, status, isAdmin: Boolean(isAdmin) });
}
