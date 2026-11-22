// Dual-context API access: prefer asUser (interactive path — verdicts
// inherit the user's permissions, spec v1), fall back to asApp when there
// is no user principal (webtriggers, scheduled triggers). In a user-less
// context the platform rejects asUser calls — sometimes by throwing an
// AUTH_TYPE error, sometimes by returning a bare 401 — so both trigger
// the fallback. A 401 with a real user present is not masked: the asApp
// attempt simply becomes the result either way.
import api from '@forge/api';

async function attempt(kind, routeArg, options) {
  const call = (client) => (kind === 'jira' ? client.requestJira(routeArg, options) : client.requestConfluence(routeArg, options));
  try {
    const res = await call(api.asUser());
    if (res.status === 401) return call(api.asApp());
    return res;
  } catch (e) {
    if (/AUTH_TYPE|401/i.test(String(e?.message ?? e))) return call(api.asApp());
    throw e;
  }
}

export const requestJira = (routeArg, options) => attempt('jira', routeArg, options);
export const requestConfluence = (routeArg, options) => attempt('confluence', routeArg, options);
