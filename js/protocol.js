// ─── DataNode codec (Bubuta binary protocol, browser) ───
// Root array: NO type byte, just 2-byte count. All ints: type 3 (int32, unsigned BE).

export function decodeNode(buf, off) {
  if (off >= buf.length) throw new Error("Premature EOF");
  const t = buf[off++];
  if (t === 0) {
    const len = (buf[off] << 16) | (buf[off + 1] << 8) | buf[off + 2];
    off += 3;
    if (off + len > buf.length) throw new Error("Premature EOF in binary");
    return [buf.slice(off, off + len), off + len];
  }
  if (t === 1) {
    const len = (buf[off] << 8) | buf[off + 1];
    off += 2;
    const decoder = new TextDecoder();
    return [decoder.decode(buf.slice(off, off + len)), off + len];
  }
  if (t === 2) {
    const v = ((buf[off] << 8) | buf[off + 1]) >>> 0;
    return [v, off + 2];
  }
  if (t === 3) {
    const v = ((buf[off] * 0x1000000) + (buf[off + 1] * 0x10000) + (buf[off + 2] * 0x100) + buf[off + 3]) >>> 0;
    return [v, off + 4];
  }
  if (t === 4) {
    const count = (buf[off] << 8) | buf[off + 1];
    off += 2;
    const arr = [];
    for (let i = 0; i < count; i++) {
      const [v, noff] = decodeNode(buf, off);
      arr.push(v);
      off = noff;
    }
    return [arr, off];
  }
  if (t === 5) {
    const count = (buf[off] << 8) | buf[off + 1];
    off += 2;
    const obj = {};
    for (let i = 0; i < count; i++) {
      const [k, koff] = decodeNode(buf, off);
      off = koff;
      const [v, voff] = decodeNode(buf, off);
      off = voff;
      obj[String(k)] = v;
    }
    return [obj, off];
  }
  throw new Error("Unknown DataNode type: " + t);
}

export function decodePayload(buf) {
  const arr = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  // Root array: 2-byte count + elements (no type byte)
  if (arr.length < 2) throw new Error("Premature EOF in root");
  const count = ((arr[0] << 8) | arr[1]) >>> 0;
  let off = 2;
  const out = [];
  for (let i = 0; i < count; i++) {
    const [v, noff] = decodeNode(arr, off);
    out.push(v);
    off = noff;
  }
  return out;
}

// ─── Encoder ───

function encodeValue(val, buf, isRoot) {
  if (Array.isArray(val)) {
    if (!isRoot) buf.push(4);
    // count 2 bytes
    buf.push((val.length >> 8) & 0xff, val.length & 0xff);
    for (const item of val) encodeValue(item, buf, false);
  } else if (val && typeof val === "object" && !(val instanceof Uint8Array) && !(val instanceof ArrayBuffer) && !ArrayBuffer.isView(val)) {
    buf.push(5);
    const keys = Object.keys(val);
    buf.push((keys.length >> 8) & 0xff, keys.length & 0xff);
    for (const k of keys) {
      let key = k;
      try { key = JSON.parse(k); } catch (e) { /* keep string key */ }
      encodeValue(key, buf, false);
      encodeValue(val[k], buf, false);
    }
  } else if (val instanceof Uint8Array || val instanceof ArrayBuffer || (ArrayBuffer.isView(val) && !(val instanceof DataView))) {
    const bytes = val instanceof Uint8Array ? val : new Uint8Array(val);
    buf.push(0);
    buf.push((bytes.length >> 16) & 0xff, (bytes.length >> 8) & 0xff, bytes.length & 0xff);
    for (const b of bytes) buf.push(b);
  } else if (typeof val === "string") {
    if (val.length >= 2 && val.startsWith("`") && val.endsWith("`")) {
      // backtick-hex binary marker
      const hex = val.slice(1, -1).replace(/[^0-9a-fA-F]/g, "");
      const bytes = new Uint8Array(hex.length / 2);
      for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
      buf.push(0);
      buf.push((bytes.length >> 16) & 0xff, (bytes.length >> 8) & 0xff, bytes.length & 0xff);
      for (const b of bytes) buf.push(b);
    } else {
      const enc = new TextEncoder().encode(val);
      buf.push(1);
      buf.push((enc.length >> 8) & 0xff, enc.length & 0xff);
      for (const b of enc) buf.push(b);
    }
  } else if (typeof val === "number" || typeof val === "bigint") {
    const n = Number(val) >>> 0;
    buf.push(3);
    buf.push((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
  } else if (val === true || val === false) {
    buf.push(3);
    buf.push(0, 0, 0, val ? 1 : 0);
  } else {
    throw new Error("Unsupported value: " + String(val));
  }
}

export function encodePayload(data) {
  if (!Array.isArray(data)) throw new Error("Root must be array");
  const buf = [];
  encodeValue(data, buf, true);
  return new Uint8Array(buf);
}

// ─── Packet framing ───

export function computeChecksum(payloadBytes) {
  const length = 4 + payloadBytes.length;
  return (length + (length >> 8) + (length >> 16) + (length >> 24)) & 0xff;
}

export function framePacket(foodgroup, type, flags, payloadBuf) {
  const cs = computeChecksum(payloadBuf);
  const length = 4 + payloadBuf.length;
  const frame = new Uint8Array(8 + payloadBuf.length);
  frame[0] = (length >>> 24) & 0xff;
  frame[1] = (length >>> 16) & 0xff;
  frame[2] = (length >>> 8) & 0xff;
  frame[3] = length & 0xff;
  frame[4] = cs;
  frame[5] = foodgroup & 0xff;
  frame[6] = type & 0xff;
  frame[7] = flags & 0xff;
  frame.set(payloadBuf instanceof Uint8Array ? payloadBuf : new Uint8Array(payloadBuf), 8);
  return frame;
}

export function parsePacketHeader(buf) {
  if (buf.length < 8) return null;
  const len = ((buf[0] << 24) | (buf[1] << 16) | (buf[2] << 8) | buf[3]) >>> 0;
  if (len < 4 || len > 16 * 1024 * 1024) return null;
  return { totalLen: 4 + len, checksum: buf[4], foodgroup: buf[5], type: buf[6], flags: buf[7] };
}

// ─── XOR (per-packet: shift resets to 0 for each packet) ───

export class XorCipher {
  constructor(key) {
    this.key = key || new Uint8Array(0);
    this.shift = 0;
  }
  process(buf) {
    const src = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    if (!this.key.length) return src;
    const out = new Uint8Array(src.length);
    for (let i = 0; i < src.length; i++) {
      out[i] = src[i] ^ this.key[i % this.key.length];
    }
    return out;
  }
}

// ─── Gzip (browser Compression Streams) ───

export async function gzipBytes(buf) {
  const cs = new CompressionStream("gzip");
  const w = cs.writable.getWriter();
  const r = cs.readable.getReader();
  w.write(buf);
  w.close();
  const chunks = [];
  while (true) {
    const { done, value } = await r.read();
    if (done) break;
    chunks.push(value);
  }
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

export async function gunzipBytes(buf) {
  const ds = new DecompressionStream("gzip");
  const w = ds.writable.getWriter();
  const r = ds.readable.getReader();
  w.write(buf);
  w.close();
  const chunks = [];
  while (true) {
    const { done, value } = await r.read();
    if (done) break;
    chunks.push(value);
  }
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

// ─── Full packet parse ───

export async function parseRawPacket(rawBuf, cipher) {
  const dec = cipher.process(rawBuf);
  const hdr = parsePacketHeader(dec);
  if (!hdr) throw new Error("Invalid packet header");
  let payload = dec.slice(8, hdr.totalLen);
  if (hdr.flags & 1) {
    try { payload = await gunzipBytes(payload); } catch (e) { /* raw already */ }
  }
  return { hdr, payload, decoded: decodePayload(payload) };
}