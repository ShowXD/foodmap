import { usageReport } from '../../lib/usage.js';

export async function onRequestGet({ env, data }) {
  if (!data.user.is_admin) return Response.json({ error: 'forbidden' }, { status: 403 });
  return Response.json(await usageReport(env.DB));
}
