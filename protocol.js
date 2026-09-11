// ─────────────────────────────────────────────
// Bubuta protocol: XOR cipher, binary nodes, framing
// Mirrors bubuta_client.py 1-to-1 for the JS web client.
// Pure browser compatible (no Node deps).
// ─────────────────────────────────────────────

export const MASKS = {
  '0': [0x98, 0x82, 0x51, 0xB0, 0x59],
  '4': [0x0F, 0xD6, 0x76, 0x90, 0x1C],
};

export const ENTRY_BLOBS = {
  cap: '040101573ee14ea7243de04fa429fbc842e963',
  mod: '040101ed3ee14ea02938e147a92991272fe09f',
  reg: '040101c53ee14ea72536e647a824475b5e63a7',
};

export function hexToBytes(hex) {
  const u = new Uint8Array(hex.length / 2);
  for (let i = 0; i < u.length; i++) u[i] = parseInt(hex.substr(i * 2, 2), 16);
  return u;
}

const _dec = new TextDecoder('utf-8');
const _enc = new TextEncoder();

export class XorCipher {
  constructor(key) {
    this.key = key ? new Uint8Array(key) : null;
  }
  process(data) {
    const out = new Uint8Array(data.length);
    if (!this.key) { out.set(data); return out; }
    const k = this.key;
    for (let i = 0; i < data.length; i++) out[i] = data[i] ^ k[i % k.length];
    return out;
  }
}

// ─── decode ───
export function decodePayload(buf) {
  buf = new Uint8Array(buf);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const cnt = dv.getUint16(0);
  let off = 2;
  const out = [];
  for (let i = 0; i < cnt; i++) {
    const v = decodeNode(buf, dv, off);
    off = v[1];
    out.push(v[0]);
  }
  return out;
}

function decodeNode(buf, dv, off) {
  const t = buf[off]; off += 1;
  if (t === 0) { // binary 3-byte len
    const ln = (buf[off] << 16) | (buf[off + 1] << 8) | buf[off + 2];
    off += 3;
    const b = buf.slice(off, off + ln);
    return [b, off + ln];
  }
  if (t === 1) { // string 2-byte len
    const ln = (buf[off] << 8) | buf[off + 1];
    off += 2;
    const s = _dec.decode(buf.slice(off, off + ln));
    return [s, off + ln];
  }
  if (t === 2) { // uint16
    const v = (buf[off] << 8) | buf[off + 1];
    return [v, off + 2];
  }
  if (t === 3) { // uint32
    const v = dv.getUint32(off);
    return [v, off + 4];
  }
  if (t === 4) { // array: 2-byte count
    const cnt = (buf[off] << 8) | buf[off + 1];
    off += 2;
    const arr = [];
    for (let i = 0; i < cnt; i++) {
      const v = decodeNode(buf, dv, off);
      off = v[1]; arr.push(v[0]);
    }
    return [arr, off];
  }
  if (t === 5) { // object: 2-byte count of pairs
    const cnt = (buf[off] << 8) | buf[off + 1];
    off += 2;
    const obj = {};
    for (let i = 0; i < cnt; i++) {
      const k = decodeNode(buf, dv, off); off = k[1];
      const v = decodeNode(buf, dv, off); off = v[1];
      obj[String(k[0])] = v[0];
    }
    return [obj, off];
  }
  if (t === 6) { // uint8
    return [buf[off], off + 1];
  }
  if (t === 7) { // uint64 (approx via two u32)
    const hi = dv.getUint32(off);
    const lo = dv.getUint32(off + 4);
    return [hi * 4294967296 + lo, off + 8];
  }
  if (t === 8) { // float64
    const v = dv.getFloat64(off);
    return [v, off + 8];
  }
  throw new Error('Unknown node type: ' + t + ' @' + off);
}

// ─── encode ───
function concatParts(parts) {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

export function encodePayload(data) {
  const parts = [];
  parts.push([(data.length >> 8) & 0xFF, data.length & 0xFF]);
  for (const item of data) encodeValue(item, parts);
  return concatParts(parts);
}

function encodeValue(val, parts) {
  if (Array.isArray(val)) {
    parts.push([4, (val.length >> 8) & 0xFF, val.length & 0xFF]);
    for (const item of val) encodeValue(item, parts);
  } else if (typeof val === 'object' && val !== null) {
    const keys = Object.keys(val);
    parts.push([5, (keys.length >> 8) & 0xFF, keys.length & 0xFF]);
    for (const k of keys) { encodeRawKey(k, parts); encodeValue(val[k], parts); }
  } else {
    encodeScalar(val, parts);
  }
}

function encodeRawKey(k, parts) {
  if (typeof k === 'string' && /^\d+$/.test(k)) {
    encodeScalar(parseInt(k, 10), parts);
  } else {
    encodeScalar(k, parts);
  }
}

function encodeScalar(val, parts) {
  if (typeof val === 'boolean') {
    const n = val ? 1 : 0;
    parts.push([3, 0, 0, 0, n]);
  } else if (typeof val === 'number') {
    const n = val >>> 0;
    parts.push([3, (n >>> 24) & 0xFF, (n >>> 16) & 0xFF, (n >>> 8) & 0xFF, n & 0xFF]);
  } else if (typeof val === 'string') {
    const raw = _enc.encode(val);
    parts.push([1, (raw.length >> 8) & 0xFF, raw.length & 0xFF, ...raw]);
  } else if (val instanceof Uint8Array) {
    const b = val;
    parts.push([0, (b.length >>> 16) & 0xFF, (b.length >>> 8) & 0xFF, b.length & 0xFF, ...b]);
  } else {
    throw new Error('Cannot encode: ' + typeof val);
  }
}

// ─── framing ───
function computeChecksum(payloadBytes) {
  const length = 4 + payloadBytes.length;
  return (length + (length >> 8) + (length >> 16) + (length >> 24)) & 0xFF;
}

export function framePacket(foodgroup, ptype, flags, payloadBytes) {
  const cs = computeChecksum(payloadBytes);
  const length = 4 + payloadBytes.length;
  const out = new Uint8Array(4 + 1 + 3 + payloadBytes.length);
  out[0] = (length >>> 24) & 0xFF;
  out[1] = (length >>> 16) & 0xFF;
  out[2] = (length >>> 8) & 0xFF;
  out[3] = length & 0xFF;
  out[4] = cs;
  out[5] = foodgroup & 0xFF;
  out[6] = ptype & 0xFF;
  out[7] = flags & 0xFF;
  out.set(payloadBytes, 8);
  return out;
}

export function parsePacketHeader(buf) {
  if (buf.length < 8) return null;
  const ln = (buf[0] << 24) | (buf[1] << 16) | (buf[2] << 8) | buf[3];
  if (ln < 4 || ln > 16 * 1024 * 1024) return null;
  return { total_len: 4 + ln, checksum: buf[4], foodgroup: buf[5], type: buf[6], flags: buf[7] };
}