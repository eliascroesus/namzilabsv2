/** Minimal JSON fetch helper used by connector poll/testFetchLatest methods. */
export async function fetchJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}${body ? `: ${body.slice(0, 300)}` : ""}`);
  }
  return (await res.json()) as T;
}

/** Basic-auth header value for `username:` (WorkOS-style API-key-as-username). */
export function basicAuth(username: string, password = ""): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}
