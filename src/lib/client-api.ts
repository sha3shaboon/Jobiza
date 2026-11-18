/** JSON fetch for the browser: throws an Error carrying the API's message. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = init?.body instanceof FormData ? init.headers : { "Content-Type": "application/json", ...init?.headers };
  const res = await fetch(path, { ...init, headers });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? body.message ?? `Request failed (${res.status})`);
  return body as T;
}
