import "server-only";
import dgram from "node:dgram";
import { randomBytes, randomUUID } from "node:crypto";
import http from "node:http";
import os from "node:os";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import { db, schema } from "@/db";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { env } from "@/lib/env";
import { loadFile, saveFile } from "@/lib/ingest/storage";
import { workspaceFor } from "../library";
import { getApiKey, storeVerifiedApiKey } from "../settings";
import { MAX_CLOCK_SKEW_MS, open, openBytes, seal, sealBytes } from "./crypto";
import { applyChanges, changesSince, type ChangeBatch } from "./feed";

/**
 * Device sync for the local apps (desktop and Android). Each device keeps its
 * own complete library and works offline; paired devices exchange changes
 * whenever they can reach each other on the local network.
 *
 * - Pairing: one device shows an invitation (QR code or text) holding a fresh
 *   32-byte key; the other uses it once. That key then seals everything.
 * - Sync: every 45 s (and on demand) each device asks each peer for changes
 *   since the last one it applied. Both sides do this, so changes flow both ways.
 * - Discovery: a small UDP broadcast announces "device X listens on port P", so
 *   peers find each other again after an address change.
 */

const DEFAULT_PORT = 47310;
const DISCOVERY_PORT = 47311;
const SYNC_EVERY_MS = 45_000;
const ANNOUNCE_EVERY_MS = 30_000;
const OFFER_MINUTES = 10;
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_BODY = 1024 * 1024;

type Peer = typeof schema.syncPeer.$inferSelect;
type State = {
  deviceId: string;
  port: number;
  server: http.Server;
  udp: dgram.Socket | null;
  timers: ReturnType<typeof setInterval>[];
  running: Map<string, Promise<SyncResult>>;
  localEmail: string;
};
export type SyncResult = { ok: boolean; applied: number; files: number; error?: string };

const g = globalThis as unknown as { __jobizaSync?: State; __jobizaSyncEmail?: string };

/* ───────────── Identity and keys ───────────── */

const aad = (what: string, id: string) => `sync:${what}:${id}`;
const lockKey = (key: Buffer, what: string, id: string) => encryptSecret(key.toString("base64"), env().ENCRYPTION_KEY, aad(what, id));
const unlockKey = (box: string, what: string, id: string) => Buffer.from(decryptSecret(box, env().ENCRYPTION_KEY, aad(what, id)), "base64");

export async function thisDevice() {
  const row = await db().query.syncDevice.findFirst();
  if (row) return row;
  // The app shell knows a friendlier name (e.g. the phone model) than the hostname.
  const name = (process.env.JOBIZA_DEVICE_NAME || os.hostname() || "This device").replace(/\.local$/, "").slice(0, 60);
  const [created] = await db().insert(schema.syncDevice).values({ id: randomUUID(), name }).returning();
  return created;
}

function lanAddresses(): string[] {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i): i is os.NetworkInterfaceInfo => Boolean(i && i.family === "IPv4" && !i.internal))
    .map((i) => i.address);
}

async function localAccount(localEmail: string) {
  const user = await db().query.user.findFirst({ where: eq(schema.user.email, localEmail) });
  if (!user) throw new Error("No local account yet");
  const ws = await workspaceFor(user.id);
  return { userId: user.id, workspaceId: ws.id };
}

/* ───────────── Network: the other side ───────────── */

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("Request too large"));
        req.destroy();
      } else parts.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(parts)));
    req.on("error", reject);
  });
}

const remoteIp = (req: http.IncomingMessage) => (req.socket.remoteAddress ?? "").replace(/^::ffff:/, "");

type Envelope<T> = T & { from: string; ts: number; port: number };

async function handle(state: State, req: http.IncomingMessage, res: http.ServerResponse) {
  const send = (code: number, body?: Buffer) => {
    res.writeHead(code, { "content-type": "application/octet-stream" });
    res.end(body);
  };
  if (req.method !== "POST") return send(405);
  const body = await readBody(req);
  const url = new URL(req.url ?? "/", "http://x");

  if (url.pathname === "/sync/pair") {
    // Sealed with the invitation's key: only someone who saw the QR code can pair.
    const offerId = req.headers["x-jobiza-offer"];
    if (typeof offerId !== "string") return send(400);
    const offer = await db().query.syncOffer.findFirst({
      where: and(eq(schema.syncOffer.id, offerId), gt(schema.syncOffer.expiresAt, new Date()), isNull(schema.syncOffer.pairedPeerId)),
    });
    if (!offer) return send(404);
    const key = unlockKey(offer.secretCiphertext, "offer", offer.id);
    let msg: Envelope<{ name: string; addresses: string[] }>;
    try {
      msg = open(key, body);
    } catch {
      return send(403);
    }
    if (Math.abs(Date.now() - msg.ts) > MAX_CLOCK_SKEW_MS) return send(403);
    await db()
      .insert(schema.syncPeer)
      .values({ id: msg.from, name: msg.name.slice(0, 80), keyCiphertext: lockKey(key, "peer", msg.from), addresses: [remoteIp(req), ...msg.addresses].slice(0, 8), port: msg.port, lastSeenAt: new Date() })
      .onConflictDoUpdate({
        target: schema.syncPeer.id,
        set: { name: msg.name.slice(0, 80), keyCiphertext: lockKey(key, "peer", msg.from), addresses: [remoteIp(req), ...msg.addresses].slice(0, 8), port: msg.port, lastSeenAt: new Date(), lastError: null },
      });
    await db().update(schema.syncOffer).set({ pairedPeerId: msg.from }).where(eq(schema.syncOffer.id, offer.id));
    const me = await thisDevice();
    const account = await localAccount(state.localEmail).catch(() => null);
    const apiKey = offer.shareApiKey && account ? await getApiKey(account.userId) : null;
    console.info(`[sync] paired with ${msg.name}`);
    setTimeout(() => void syncPeer(msg.from), 500);
    return send(200, seal(key, { from: me.id, name: me.name, ts: Date.now(), port: state.port, apiKey }));
  }

  // Everything else comes from a paired device and is sealed with its key.
  const from = req.headers["x-jobiza-device"];
  if (typeof from !== "string") return send(400);
  const peer = await db().query.syncPeer.findFirst({ where: eq(schema.syncPeer.id, from) });
  if (!peer) return send(403);
  const key = unlockKey(peer.keyCiphertext, "peer", peer.id);
  let msg: Envelope<Record<string, unknown>>;
  try {
    msg = open(key, body);
  } catch {
    return send(403);
  }
  if (msg.from !== peer.id || Math.abs(Date.now() - msg.ts) > MAX_CLOCK_SKEW_MS) return send(403);
  await notePeerAddress(peer, remoteIp(req), msg.port);

  if (url.pathname === "/sync/changes") {
    const batch = await changesSince(Number(msg.since ?? 0));
    return send(200, seal(key, batch));
  }
  if (url.pathname === "/sync/file") {
    const paper = await db().query.paper.findFirst({ where: eq(schema.paper.id, String(msg.paperId)) });
    if (!paper?.fileKey) return send(404);
    const data = await loadFile(paper.fileKey).catch(() => null);
    return data ? send(200, sealBytes(key, data)) : send(404);
  }
  if (url.pathname === "/sync/poke") {
    // The other device changed something: pull from it soon.
    setTimeout(() => void syncPeer(peer.id), 200);
    return send(204);
  }
  return send(404);
}

async function notePeerAddress(peer: Peer, ip: string, port: number) {
  if (!ip) return;
  const addresses = [ip, ...peer.addresses.filter((a) => a !== ip)].slice(0, 8);
  if (addresses[0] === peer.addresses[0] && port === peer.port && peer.lastSeenAt && Date.now() - peer.lastSeenAt.getTime() < 30_000) return;
  await db().update(schema.syncPeer).set({ addresses, port, lastSeenAt: new Date() }).where(eq(schema.syncPeer.id, peer.id));
}

/* ───────────── Network: asking a peer ───────────── */

function post(address: string, port: number, path: string, headers: Record<string, string>, body: Buffer): Promise<{ status: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: address, port, path, method: "POST", headers: { ...headers, "content-type": "application/octet-stream", "content-length": body.length }, timeout: REQUEST_TIMEOUT_MS },
      (res) => {
        const parts: Buffer[] = [];
        res.on("data", (c: Buffer) => parts.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(parts) }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", reject);
    req.end(body);
  });
}

/** Call a peer at whichever of its known addresses answers first. */
async function callPeer(peer: Peer, key: Buffer, path: string, payload: Record<string, unknown>) {
  const state = g.__jobizaSync!;
  let lastError: unknown = new Error("No known address");
  for (const address of peer.addresses) {
    try {
      const body = seal(key, { ...payload, from: state.deviceId, ts: Date.now(), port: state.port });
      const res = await post(address, peer.port, path, { "x-jobiza-device": state.deviceId }, body);
      if (res.status === 403) throw new Error("The other device no longer recognises this one. Pair them again.");
      if (address !== peer.addresses[0]) {
        peer.addresses = [address, ...peer.addresses.filter((a) => a !== address)];
        await db().update(schema.syncPeer).set({ addresses: peer.addresses }).where(eq(schema.syncPeer.id, peer.id));
      }
      return res;
    } catch (err) {
      lastError = err;
      if ((err as Error).message.includes("Pair them again")) throw err;
    }
  }
  throw lastError;
}

/** Pull everything new from one peer, then fetch PDFs the new papers need. */
export async function syncPeer(peerId: string): Promise<SyncResult> {
  const state = g.__jobizaSync;
  if (!state) return { ok: false, applied: 0, files: 0, error: "Sync isn't running" };
  const running = state.running.get(peerId);
  if (running) return running;
  const job = (async (): Promise<SyncResult> => {
    const peer = await db().query.syncPeer.findFirst({ where: eq(schema.syncPeer.id, peerId) });
    if (!peer) return { ok: false, applied: 0, files: 0, error: "Unknown device" };
    const key = unlockKey(peer.keyCiphertext, "peer", peer.id);
    let applied = 0;
    const files = new Set<string>();
    try {
      const local = await localAccount(state.localEmail);
      let cursor = peer.cursor;
      for (let round = 0; round < 500; round++) {
        const res = await callPeer(peer, key, "/sync/changes", { since: cursor });
        if (res.status !== 200) throw new Error(`The other device answered ${res.status}`);
        const batch = open<ChangeBatch>(key, res.body);
        const result = await applyChanges(batch, local);
        applied += result.applied;
        result.files.forEach((f) => files.add(f));
        cursor = batch.cursor;
        await db().update(schema.syncPeer).set({ cursor }).where(eq(schema.syncPeer.id, peer.id));
        if (!batch.more) break;
      }
      for (const paperId of files) await fetchFile(peer, key, paperId, local.workspaceId);
      await db().update(schema.syncPeer).set({ lastSyncAt: new Date(), lastSeenAt: new Date(), lastError: null }).where(eq(schema.syncPeer.id, peer.id));
      if (applied) console.info(`[sync] ${applied} change(s) from ${peer.name}`);
      return { ok: true, applied, files: files.size };
    } catch (err) {
      const message = (err as Error).message;
      const offline = /ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|timed out|No known address|ETIMEDOUT|ECONNRESET/.test(message);
      const error = offline ? "Not reachable right now" : message;
      await db().update(schema.syncPeer).set({ lastError: error }).where(eq(schema.syncPeer.id, peer.id));
      if (!offline) console.error(`[sync] with ${peer.name} failed: ${message}`);
      return { ok: false, applied, files: files.size, error };
    }
  })();
  state.running.set(peerId, job);
  try {
    return await job;
  } finally {
    state.running.delete(peerId);
  }
}

async function fetchFile(peer: Peer, key: Buffer, paperId: string, workspaceId: string) {
  const fileKey = `${workspaceId}/${paperId}.pdf`;
  const have = await loadFile(fileKey).then(
    () => true,
    () => false,
  );
  if (have) return;
  const res = await callPeer(peer, key, "/sync/file", { paperId });
  if (res.status !== 200) return; // the paper may have lost its file; the text and search still work
  await saveFile(fileKey, openBytes(key, res.body));
}

export async function syncAll() {
  const peers = await db().query.syncPeer.findMany();
  return Promise.all(peers.map((p) => syncPeer(p.id)));
}

/** Tell peers there's something new, so they pull without waiting for the timer. */
export async function pokePeers() {
  const state = g.__jobizaSync;
  if (!state) return;
  for (const peer of await db().query.syncPeer.findMany()) {
    const key = unlockKey(peer.keyCiphertext, "peer", peer.id);
    void callPeer(peer, key, "/sync/poke", {}).catch(() => undefined);
  }
}

/* ───────────── Pairing ───────────── */

const OFFER_PREFIX = "jobiza-pair:1:";

/** An invitation another device can use once, for a few minutes. Shown as a QR code and as text. */
export async function createOffer(shareApiKey: boolean) {
  const state = g.__jobizaSync;
  if (!state) throw new Error("Sync isn't running");
  const me = await thisDevice();
  const id = randomUUID();
  const secret = randomBytes(32);
  const expiresAt = new Date(Date.now() + OFFER_MINUTES * 60_000);
  await db().insert(schema.syncOffer).values({ id, secretCiphertext: lockKey(secret, "offer", id), shareApiKey, expiresAt });
  const payload = { o: id, k: secret.toString("base64url"), a: lanAddresses(), p: state.port, n: me.name };
  return { id, text: OFFER_PREFIX + Buffer.from(JSON.stringify(payload)).toString("base64url"), expiresAt: expiresAt.toISOString(), addresses: payload.a };
}

export async function offerStatus(id: string) {
  const offer = await db().query.syncOffer.findFirst({ where: eq(schema.syncOffer.id, id) });
  if (!offer) return { state: "unknown" as const };
  if (offer.pairedPeerId) {
    const peer = await db().query.syncPeer.findFirst({ where: eq(schema.syncPeer.id, offer.pairedPeerId) });
    return { state: "paired" as const, peerName: peer?.name ?? "A device" };
  }
  return { state: offer.expiresAt.getTime() < Date.now() ? ("expired" as const) : ("waiting" as const) };
}

export class PairingError extends Error {}

/** Use an invitation from another device. */
export async function joinWithOffer(text: string) {
  const state = g.__jobizaSync;
  if (!state) throw new PairingError("Sync isn't running");
  const trimmed = text.trim();
  if (!trimmed.startsWith(OFFER_PREFIX)) throw new PairingError("That isn't a Jobiza pairing code.");
  let offer: { o: string; k: string; a: string[]; p: number; n: string };
  try {
    offer = JSON.parse(Buffer.from(trimmed.slice(OFFER_PREFIX.length), "base64url").toString("utf8"));
  } catch {
    throw new PairingError("That pairing code is incomplete. Copy all of it.");
  }
  const key = Buffer.from(offer.k, "base64url");
  if (key.length !== 32 || !Array.isArray(offer.a)) throw new PairingError("That pairing code is incomplete. Copy all of it.");
  const me = await thisDevice();
  const body = seal(key, { from: me.id, name: me.name, ts: Date.now(), port: state.port, addresses: lanAddresses() });
  let res: { status: number; body: Buffer } | null = null;
  let reached = "";
  for (const address of offer.a.length ? offer.a : ["127.0.0.1"]) {
    try {
      res = await post(address, offer.p, "/sync/pair", { "x-jobiza-offer": offer.o }, body);
      reached = address;
      break;
    } catch {
      // try the next address
    }
  }
  if (!res) throw new PairingError(`Couldn't reach ${offer.n}. Make sure both devices are on the same Wi-Fi network and Jobiza is open on both.`);
  if (res.status === 404) throw new PairingError("That code has expired or was already used. Make a new one on the other device.");
  if (res.status !== 200) throw new PairingError("The other device refused the pairing. Make a new code and try again.");
  const reply = open<{ from: string; name: string; ts: number; port: number; apiKey: string | null }>(key, res.body);
  await db()
    .insert(schema.syncPeer)
    .values({ id: reply.from, name: reply.name.slice(0, 80), keyCiphertext: lockKey(key, "peer", reply.from), addresses: [reached, ...offer.a.filter((a) => a !== reached)], port: reply.port, lastSeenAt: new Date() })
    .onConflictDoUpdate({
      target: schema.syncPeer.id,
      set: { name: reply.name.slice(0, 80), keyCiphertext: lockKey(key, "peer", reply.from), addresses: [reached, ...offer.a.filter((a) => a !== reached)], port: reply.port, lastSeenAt: new Date(), lastError: null, cursor: 0 },
    });
  if (reply.apiKey) {
    const account = await localAccount(state.localEmail);
    await storeVerifiedApiKey(account.userId, reply.apiKey, new Date());
    // Storing the key isn't a preference change: let the other device's model and style win.
    await db().update(schema.userSettings).set({ updatedAt: new Date(0) }).where(eq(schema.userSettings.userId, account.userId));
  }
  console.info(`[sync] paired with ${reply.name}`);
  void syncPeer(reply.from);
  return { peerId: reply.from, name: reply.name, apiKeyCopied: Boolean(reply.apiKey) };
}

export async function forgetPeer(id: string) {
  await db().delete(schema.syncPeer).where(eq(schema.syncPeer.id, id));
}

/* ───────────── Discovery ───────────── */

function startDiscovery(state: State) {
  const udp = dgram.createSocket({ type: "udp4", reuseAddr: true });
  udp.on("error", (err) => {
    console.warn(`[sync] discovery unavailable: ${err.message}`);
    udp.close();
    state.udp = null;
  });
  udp.on("message", (raw, rinfo) => {
    try {
      const msg = JSON.parse(raw.toString("utf8")) as { app?: string; id?: string; port?: number };
      if (msg.app !== "jobiza" || !msg.id || msg.id === state.deviceId || typeof msg.port !== "number") return;
      void db()
        .query.syncPeer.findFirst({ where: eq(schema.syncPeer.id, msg.id) })
        .then(async (peer) => {
          if (!peer) return;
          const isNew = peer.addresses[0] !== rinfo.address || peer.port !== msg.port;
          await notePeerAddress(peer, rinfo.address, msg.port!);
          // A peer that just appeared (or moved) gets a sync straight away.
          if (isNew || !peer.lastSyncAt || Date.now() - peer.lastSyncAt.getTime() > SYNC_EVERY_MS) void syncPeer(peer.id);
        });
    } catch {
      // not ours
    }
  });
  udp.bind(DISCOVERY_PORT, () => {
    udp.setBroadcast(true);
    const announce = () => {
      const msg = Buffer.from(JSON.stringify({ app: "jobiza", v: 1, id: state.deviceId, port: state.port }));
      udp.send(msg, DISCOVERY_PORT, "255.255.255.255", () => undefined);
    };
    announce();
    state.timers.push(setInterval(announce, ANNOUNCE_EVERY_MS));
  });
  state.udp = udp;
}

/* ───────────── Start and status ───────────── */

function listen(server: http.Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.off("listening", onListening);
      reject(err);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve((server.address() as { port: number }).port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "0.0.0.0");
  });
}

export async function startSync(localEmail: string) {
  g.__jobizaSyncEmail = localEmail;
  if (g.__jobizaSync) return;
  await db().delete(schema.syncOffer).where(and(isNull(schema.syncOffer.pairedPeerId), lt(schema.syncOffer.expiresAt, new Date())));
  const me = await thisDevice();
  if (!me.enabled) return;
  const server = http.createServer((req, res) => {
    handle(g.__jobizaSync!, req, res).catch((err) => {
      console.error("[sync] request failed:", (err as Error).message);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  const wanted = Number(process.env.JOBIZA_SYNC_PORT) || DEFAULT_PORT;
  // The usual port lets peers find each other again easily; any free port works too.
  const port = await listen(server, wanted).catch(() => listen(server, 0));
  const state: State = { deviceId: me.id, port, server, udp: null, timers: [], running: new Map(), localEmail };
  g.__jobizaSync = state;
  if (process.env.JOBIZA_SYNC_DISCOVERY !== "0") startDiscovery(state);
  state.timers.push(setInterval(() => void syncAll(), SYNC_EVERY_MS));
  setTimeout(() => void syncAll(), 2000);
  console.info(`[sync] listening on port ${port}`);
}

export async function stopSync() {
  const state = g.__jobizaSync;
  if (!state) return;
  state.timers.forEach(clearInterval);
  state.udp?.close();
  await new Promise((r) => state.server.close(r));
  g.__jobizaSync = undefined;
}

export async function syncStatus() {
  const me = await thisDevice();
  const peers = await db().query.syncPeer.findMany({ orderBy: (p, { asc }) => [asc(p.createdAt)] });
  const state = g.__jobizaSync;
  return {
    device: { id: me.id, name: me.name, enabled: me.enabled, running: Boolean(state), port: state?.port ?? null, addresses: lanAddresses() },
    peers: peers.map((p) => ({
      id: p.id,
      name: p.name,
      lastSyncAt: p.lastSyncAt?.toISOString() ?? null,
      lastSeenAt: p.lastSeenAt?.toISOString() ?? null,
      lastError: p.lastError,
      syncing: Boolean(state?.running.has(p.id)),
    })),
  };
}

export async function updateDevice(patch: { name?: string; enabled?: boolean }) {
  const me = await thisDevice();
  await db().update(schema.syncDevice).set(patch).where(eq(schema.syncDevice.id, me.id));
  if (patch.enabled === false) await stopSync();
  if (patch.enabled === true && g.__jobizaSync === undefined) await startSync(g.__jobizaSyncEmail ?? "");
}

