/**
 * scripts/x11.mjs (F375 smoke harness) — a minimal, dependency-free X11
 * client that answers ONE question: what are the WM_NAME titles of the
 * top-level windows on a display? The smoke asserts the NATIVE window
 * title ("FleetOS") — the BrowserWindow title, not the page's
 * document.title — and this box has no xdotool, so the smoke speaks the
 * X11 core protocol itself: connect the unix socket, InternAtom WM_NAME,
 * QueryTree the root, GetProperty per child. Fixed facts only.
 */

import { connect } from "node:net";
import { existsSync } from "node:fs";

/** Buffered message reader over the X socket: resolves once `total` bytes
 *  are available, leaving the rest for the next read. */
class XReader {
  constructor(socket) {
    this.buffer = Buffer.alloc(0);
    this.socket = socket;
  }

  read(total) {
    if (this.buffer.length >= total) {
      const out = this.buffer.subarray(0, total);
      this.buffer = this.buffer.subarray(total);
      return Promise.resolve(out);
    }
    return new Promise((resolve, reject) => {
      const onData = (chunk) => {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        if (this.buffer.length >= total) {
          const out = this.buffer.subarray(0, total);
          this.buffer = this.buffer.subarray(total);
          this.socket.off("data", onData);
          this.socket.off("error", onErr);
          resolve(out);
        }
      };
      const onErr = (error) => {
        this.socket.off("data", onData);
        reject(error);
      };
      this.socket.on("data", onData);
      this.socket.on("error", onErr);
    });
  }
  /** Read one reply-or-error, SKIPPING unsolicited events (event packets
   *  are exactly 32 bytes with a code ≥ 2 in byte 0; replies have 1,
   *  errors 0 — and only replies carry a variable-length body). */
  async readReply() {
    for (;;) {
      const head = await this.read(32);
      if (head[0] >= 2) continue; // an event — skip it
      if (head[0] === 0) return head; // an error: exactly 32 bytes
      const extra = head.readUInt32LE(4) * 4;
      const body = extra > 0 ? await this.read(extra) : Buffer.alloc(0);
      return Buffer.concat([head, body]);
    }
  }
}

function pad4(n) {
  return (4 - (n % 4)) % 4;
}

function u16(v) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(v, 0);
  return b;
}

function u32(v) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v, 0);
  return b;
}

/** X11 little-endian connection + the tiny request set the harness needs.
 *  Returns the WM_NAME strings of every top-level window. */
async function x11Titles(display) {
  const m = /^:([0-9]+)(?:\.[0-9]+)?$/.exec(display);
  if (m === null) throw new Error(`unsupported DISPLAY for the title query: ${display}`);
  const socketPath = `/tmp/.X11-unix/X${m[1]}`;
  if (!existsSync(socketPath)) throw new Error(`no X socket at ${socketPath}`);
  const socket = connect(socketPath);
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  const reader = new XReader(socket);

  // Handshake: byte order 'l', protocol 11.0, no auth.
  socket.write(Buffer.from([0x6c, 0, 11, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
  const head = await reader.read(8);
  if (head[0] !== 1) throw new Error("X11 connection failed (not a success reply)");
  const setup = Buffer.concat([head, await reader.read(head.readUInt16LE(6) * 4)]);
  // Setup layout: header(8) + release(4) + id-base(4) + id-mask(4) +
  // motion-buffer(4) + vendor-len(2) + max-request(2) + n-screens(1) +
  // n-formats(1) + 7 bytes + pad(4) + vendor(padded) + formats(8n) + screens.
  const vendorLen = setup.readUInt16LE(24);
  const nFormats = setup[29];
  // Screens start after: vendor (vendorLen bytes padded to 4) + formats (8n).
  const screensAt = 40 + vendorLen + pad4(vendorLen) + 8 * nFormats;
  const root = setup.readUInt32LE(screensAt);

  // InternAtom for both title properties: WM_NAME (STRING, legacy) and
  // _NET_WM_NAME (UTF-8, the EWMH title Chromium keeps current).
  async function internAtom(atomName) {
    const name = Buffer.from(atomName, "ascii");
    socket.write(
      Buffer.concat([
        Buffer.from([16, 0]),
        u16(2 + (name.length + pad4(name.length)) / 4),
        u16(name.length),
        u16(0),
        name,
        Buffer.alloc(pad4(name.length)),
      ]),
    );
    const reply = await reader.readReply();
    if (reply[0] !== 1) throw new Error(`InternAtom(${atomName}) failed`);
    return reply.readUInt32LE(8);
  }
  const wmName = await internAtom("WM_NAME");
  const netWmName = await internAtom("_NET_WM_NAME");

  // QueryTree (opcode 15) on the root window. readReply returns the FULL
  // message (header + body); the child ids live at offset 32.
  socket.write(Buffer.concat([Buffer.from([15, 0]), u16(2), u32(root)]));
  const tree = await reader.readReply();
  if (tree[0] !== 1) throw new Error("QueryTree failed");
  const count = tree.readUInt32LE(16);
  const children = [];
  for (let i = 0; i < count; i += 1) children.push(tree.readUInt32LE(32 + 4 * i));

  // GetProperty (opcode 20) per child window: _NET_WM_NAME first (the title
  // Chromium keeps current), WM_NAME as the legacy fallback. The value
  // lives at byte 32 of the reply (after the fixed header).
  const titles = [];
  for (const window of children) {
    for (const property of [netWmName, wmName]) {
      socket.write(
        Buffer.concat([
          Buffer.from([20, 0]),
          u16(6),
          u32(window),
          u32(property),
          u32(0), // AnyPropertyType
          u32(0), // long offset
          u32(1024), // long length
        ]),
      );
      const prop = await reader.readReply();
      if (prop[0] === 0) continue; // X error (no such property) — skip
      const valueLen = prop.readUInt32LE(16);
      if (valueLen === 0 || prop[1] === 0) continue;
      titles.push(prop.subarray(32, 32 + valueLen).toString("utf-8"));
      break;
    }
  }
  socket.end();
  return titles;
}

export { x11Titles };
