import { AI_CHOICES, aiModel } from '../../lib/ai.js';

const json = (body, status = 200) => Response.json(body, { status });
const forbidden = () => json({ error: 'forbidden' }, 403);

/** GET: the site-wide settings a site admin can change (the AI model and the models to choose from). */
export async function onRequestGet({ env, data }) {
  if (!data.user.is_admin) return forbidden();
  return json({
    ai_model: await aiModel(env.DB),
    models: Object.entries(AI_CHOICES).map(([id, label]) => ({ id, label })),
  });
}

/** PUT {ai_model}: only models from the tested list, so a typo or an untried model can't break AI. */
export async function onRequestPut({ request, env, data }) {
  if (!data.user.is_admin) return forbidden();
  const body = await request.json().catch(() => null);
  if (!AI_CHOICES[body?.ai_model]) return json({ error: 'unknown model' }, 400);
  await env.DB
    .prepare("INSERT INTO settings (key, value) VALUES ('ai_model', ?1) ON CONFLICT (key) DO UPDATE SET value = ?1")
    .bind(body.ai_model)
    .run();
  return json({ ai_model: body.ai_model });
}
