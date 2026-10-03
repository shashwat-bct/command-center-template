export const ADMIN_TOKEN_KEY = "cct_admin_token";

/**
 * Calls an admin endpoint, asking for the admin token only if the server
 * rejects the request, and remembering it for the tab once accepted.
 */
export async function adminFetch(url: string, init: { method?: string; body?: string; headers?: Record<string, string> } = {}): Promise<Response> {
  const send = (token: string | null) =>
    fetch(url, { ...init, headers: { ...(init.headers ?? {}), ...(token ? { "x-admin-token": token } : {}) } });
  let res = await send(sessionStorage.getItem(ADMIN_TOKEN_KEY));
  if (res.status !== 401) return res;
  sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  const token = prompt("Admin token (from Secret Manager → ADMIN_SHARED_SECRET):");
  if (!token) return res;
  res = await send(token);
  if (res.status !== 401) sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
  return res;
}
