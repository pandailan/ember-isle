import type { Peer, DataConnection } from "peerjs";

/* PeerJS streams in only when someone actually reaches for co-op. */
type PeerClass = typeof import("peerjs").Peer;
let PeerCtor: PeerClass | null = null;
async function loadPeer(): Promise<PeerClass> {
  if (!PeerCtor) {
    const m = await import("peerjs");
    PeerCtor = (m.Peer ?? (m as unknown as {default: PeerClass}).default) as PeerClass;
  }
  return PeerCtor;
}

export type NetRole = "solo" | "host" | "guest";
export interface NetMsg { t: string; [k: string]: unknown; }

const ID_PREFIX = "ember-isle-";
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L

function makeCode(): string {
  let s = "";
  for (let i = 0; i < 4; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return s;
}

/** Default is the free public PeerJS broker; ?peerhost=…&peerport=… selects a self-hosted server. */
function peerOpts(): ConstructorParameters<typeof Peer>[1] {
  const q = new URLSearchParams(location.search);
  const host = q.get("peerhost");
  if (!host) return {};
  return {
    host,
    port: Number(q.get("peerport") || 9000),
    path: q.get("peerpath") || "/",
    secure: q.get("peersecure") === "1",
  };
}

class Net {
  role: NetRole = "solo";
  code = "";
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  onMessage: ((m: NetMsg) => void) | null = null;
  onPeerChange: (() => void) | null = null;

  get connected(): boolean { return !!this.conn && this.conn.open; }

  host(cb: (codeOrErr: string, ok: boolean) => void): void {
    if (this.peer) { cb(this.code, this.role === "host"); return; }
    const code = makeCode();
    let settled = false;
    const done = (msg: string, ok: boolean) => { if (!settled) { settled = true; cb(msg, ok); } };
    loadPeer().then(P => {
      const peer = new P(ID_PREFIX + code, peerOpts());
      this.peer = peer;
      peer.on("open", () => { this.role = "host"; this.code = code; done(code, true); });
      peer.on("error", e => { this.reset(); done(String((e as Error).message || e), false); });
      peer.on("connection", c => {
        if (this.conn) { c.close(); return; } // one companion only
        c.on("open", () => this.wire(c));
      });
    }).catch(e => { this.reset(); done(String(e), false); });
  }

  join(code: string, cb: (err?: string) => void): void {
    let settled = false;
    const done = (err?: string) => { if (!settled) { settled = true; cb(err); } };
    loadPeer().then(P => {
      const peer = new P(peerOpts() as unknown as string);
      this.peer = peer;
      peer.on("error", e => { this.reset(); done(String((e as Error).message || e)); });
      peer.on("open", () => {
        const c = peer.connect(ID_PREFIX + code.toUpperCase().trim(), { reliable: true });
        c.on("open", () => { this.role = "guest"; this.wire(c); done(); });
        c.on("error", e => { this.reset(); done(String(e)); });
      });
      setTimeout(() => done("No answer — check the code and try again."), 12000);
    }).catch(e => { this.reset(); done(String(e)); });
  }

  private hbTimer: ReturnType<typeof setInterval> | null = null;
  private lastRecv = 0;

  private wire(c: DataConnection): void {
    this.conn = c;
    this.lastRecv = Date.now();
    c.on("data", d => {
      this.lastRecv = Date.now();
      try {
        const m = (typeof d === "string" ? JSON.parse(d) : d) as NetMsg;
        if (!m || typeof m.t !== "string" || m.t === "__ping") return;
        if (this.onMessage) this.onMessage(m);
      } catch { /* ignore malformed frames */ }
    });
    c.on("close", () => this.dropConn());
    c.on("error", () => this.dropConn());
    // PeerJS close events are unreliable on abrupt peer loss — heartbeat instead.
    this.hbTimer = setInterval(() => {
      if (!this.conn) return;
      try { this.conn.send(JSON.stringify({t: "__ping"})); } catch { /* dropping anyway */ }
      if (Date.now() - this.lastRecv > 7000) this.dropConn();
    }, 2000);
    if (this.onPeerChange) this.onPeerChange();
  }

  private dropConn(): void {
    if (!this.conn) return;
    const c = this.conn;
    this.conn = null;
    if (this.hbTimer) { clearInterval(this.hbTimer); this.hbTimer = null; }
    try { c.close(); } catch { /* already gone */ }
    if (this.role === "guest") this.reset();
    if (this.onPeerChange) this.onPeerChange();
  }

  send(m: NetMsg): void {
    if (this.connected) this.conn!.send(JSON.stringify(m));
  }

  private reset(): void {
    try { this.peer?.destroy(); } catch { /* already gone */ }
    this.peer = null; this.conn = null; this.role = "solo"; this.code = "";
  }
}

export const net = new Net();
