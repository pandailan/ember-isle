import Peer from "peerjs";
import type { DataConnection } from "peerjs";

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
    try {
      const peer = new Peer(ID_PREFIX + code, peerOpts());
      this.peer = peer;
      peer.on("open", () => { this.role = "host"; this.code = code; done(code, true); });
      peer.on("error", e => { this.reset(); done(String((e as Error).message || e), false); });
      peer.on("connection", c => {
        if (this.conn) { c.close(); return; } // one companion only
        c.on("open", () => this.wire(c));
      });
    } catch (e) { this.reset(); done(String(e), false); }
  }

  join(code: string, cb: (err?: string) => void): void {
    let settled = false;
    const done = (err?: string) => { if (!settled) { settled = true; cb(err); } };
    try {
      const peer = new Peer(peerOpts() as object);
      this.peer = peer;
      peer.on("error", e => { this.reset(); done(String((e as Error).message || e)); });
      peer.on("open", () => {
        const c = peer.connect(ID_PREFIX + code.toUpperCase().trim(), { reliable: true });
        c.on("open", () => { this.role = "guest"; this.wire(c); done(); });
        c.on("error", e => { this.reset(); done(String(e)); });
      });
      setTimeout(() => done("No answer — check the code and try again."), 12000);
    } catch (e) { this.reset(); done(String(e)); }
  }

  private wire(c: DataConnection): void {
    this.conn = c;
    c.on("data", d => {
      try {
        const m = (typeof d === "string" ? JSON.parse(d) : d) as NetMsg;
        if (m && typeof m.t === "string" && this.onMessage) this.onMessage(m);
      } catch { /* ignore malformed frames */ }
    });
    const drop = () => {
      this.conn = null;
      if (this.role === "guest") this.reset();
      if (this.onPeerChange) this.onPeerChange();
    };
    c.on("close", drop);
    c.on("error", drop);
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
