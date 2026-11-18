import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

/**
 * Fetch for user-supplied URLs (paper imports). Guards against SSRF: only
 * http(s), only public addresses (checked for every redirect hop), bounded
 * size and time.
 */

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(net, prefix, "ipv6");
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  // IPv4-mapped IPv6 (::ffff:10.0.0.1) is checked as IPv4.
  const mapped = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return !blocked.check(mapped[1], "ipv4");
  return !blocked.check(address, family === 6 ? "ipv6" : "ipv4");
}

export class UnsafeUrlError extends Error {}

export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("That isn't a valid web address.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new UnsafeUrlError("Only http and https links can be imported.");
  if (url.username || url.password) throw new UnsafeUrlError("Links with embedded credentials can't be imported.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address))) {
    throw new UnsafeUrlError("That address points to a private network and can't be imported.");
  }
  return url;
}

export type SafeFetchResult = { url: string; contentType: string; body: Buffer };

export async function safeFetch(
  rawUrl: string,
  { maxBytes = 50 * 1024 * 1024, timeoutMs = 30_000, maxRedirects = 5, accept = "*/*" } = {},
): Promise<SafeFetchResult> {
  const signal = AbortSignal.timeout(timeoutMs);
  let current = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const url = await assertPublicUrl(current);
    const res = await fetch(url, {
      redirect: "manual",
      signal,
      headers: { "user-agent": "Jobiza/0.1 (research assistant; paper import)", accept },
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new Error(`Redirect without a location (${res.status}).`);
      current = new URL(location, url).toString();
      continue;
    }
    if (!res.ok) throw new Error(`The site responded with ${res.status}.`);
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > maxBytes) throw new Error("The file is too large to import (limit 50 MB).");
    const reader = res.body?.getReader();
    if (!reader) throw new Error("The site sent an empty response.");
    const parts: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error("The file is too large to import (limit 50 MB).");
      }
      parts.push(value);
    }
    return { url: url.toString(), contentType: res.headers.get("content-type") ?? "", body: Buffer.concat(parts) };
  }
  throw new Error("Too many redirects.");
}
