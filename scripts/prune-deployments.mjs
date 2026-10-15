// Pages keeps every deployment forever, each on its own URL still running that old code against the
// live database, so after each deploy only the newest few are kept (enough to roll back from the dashboard).
// Needs CLOUDFLARE_API_TOKEN (Account → Cloudflare Pages → Edit) and CLOUDFLARE_ACCOUNT_ID.
const PROJECT = 'foodmap';
const KEEP = 5;

const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: accountId } = process.env;
if (!token || !accountId) throw new Error('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required');
const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${PROJECT}`;

async function call(path, method = 'GET') {
  const response = await fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${token}` } });
  const body = await response.json();
  if (!body.success) throw new Error(`${method} ${path} failed: ${JSON.stringify(body.errors)}`);
  return body;
}

const liveId = (await call('')).result.canonical_deployment?.id;
const deployments = [];
for (let page = 1; ; page++) {
  const { result, result_info: info } = await call(`/deployments?page=${page}&per_page=25`);
  deployments.push(...result);
  if (result.length === 0 || deployments.length >= info.total_count) break;
}
deployments.sort((a, b) => b.created_on.localeCompare(a.created_on));

const old = deployments.slice(KEEP).filter((deployment) => deployment.id !== liveId);
for (const deployment of old) {
  // force: also removes deployments that still carry a branch alias.
  await call(`/deployments/${deployment.id}?force=true`, 'DELETE');
  console.log(`Deleted ${deployment.short_id ?? deployment.id} (${deployment.created_on})`);
}
console.log(`Kept ${deployments.length - old.length} of ${deployments.length} deployments.`);
