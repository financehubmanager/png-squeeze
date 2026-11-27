// png-squeeze-01 entry: lossless PNG re-encoder for 1280x720 RGBA screenshots.
// Strategy: pick the best colour form (palette / grey / grey+alpha / RGB / RGBA / tRNS key),
// the best per-row filter (fixed, min-sum, fewest-pairs, or per-row brute force by real
// deflate cost), then encode the filtered stream with the smallest of several deflate
// backends: Node zlib level 9 (strategies default/filtered) and a from-scratch
// zopfli-style optimal-parsing deflate (hash-chain LZ77 + DP shortest-path parse +
// per-block length-limited Huffman, iterated). Pure Node built-ins, no dependencies,
// fully deterministic: no clock, no randomness, fixed work per image.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { constants, deflateSync, inflateSync } from 'node:zlib';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// ---------------------------------------------------------------- PNG codec ----

const SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(bytes, start = 0, end = bytes.length) {
  let c = -1;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function adler32(bytes) {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; ) {
    const end = Math.min(bytes.length, i + 5552);
    for (; i < end; i++) {
      a += bytes[i];
      b += a;
    }
    a %= 65521;
    b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}

const ascii = (s) => Uint8Array.from(s, (ch) => ch.charCodeAt(0));

function pngOf(chunks) {
  let size = SIGNATURE.length;
  for (const [, data] of chunks) size += 12 + data.length;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  out.set(SIGNATURE, 0);
  let at = SIGNATURE.length;
  for (const [type, data] of chunks) {
    view.setUint32(at, data.length);
    out.set(ascii(type), at + 4);
    out.set(data, at + 8);
    view.setUint32(at + 8 + data.length, crc32(out, at + 4, at + 8 + data.length));
    at += 12 + data.length;
  }
  return out;
}

function ihdrOf(width, height, colourType) {
  const d = new Uint8Array(13);
  new DataView(d.buffer).setUint32(0, width);
  new DataView(d.buffer).setUint32(4, height);
  d[8] = 8;
  d[9] = colourType;
  return d;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = p > a ? p - a : a - p;
  const pb = p > b ? p - b : b - p;
  const pc = p > c ? p - c : c - p;
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

// Decode a bit-depth-8 non-interlaced PNG of colour type 0/2/3/4/6 to RGBA.
function decodePng(bytes) {
  if (bytes.length < 8 || SIGNATURE.some((b, i) => bytes[i] !== b)) throw new Error('bad PNG signature');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 8;
  let header = null;
  let palette = null;
  let trns = null;
  const idat = [];
  let ended = false;
  while (at < bytes.length) {
    if (ended) throw new Error('bytes after IEND');
    const len = view.getUint32(at);
    if (at + 12 + len > bytes.length) throw new Error('truncated chunk');
    const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
    if (crc32(bytes, at + 4, at + 8 + len) !== view.getUint32(at + 8 + len)) throw new Error(`${type} CRC fail`);
    const data = bytes.subarray(at + 8, at + 8 + len);
    at += 12 + len;
    if (type === 'IHDR') {
      const dv = new DataView(data.buffer, data.byteOffset, 13);
      header = { width: dv.getUint32(0), height: dv.getUint32(4), depth: data[8], colourType: data[9], interlace: data[12] };
      if (header.depth !== 8 || header.interlace !== 0 || !Object.hasOwn(CHANNELS, header.colourType)) throw new Error('unsupported IHDR');
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') ended = true;
    else throw new Error(`unexpected chunk ${type}`);
  }
  if (!ended || idat.length === 0) throw new Error('no IEND/IDAT');
  const { width, height, colourType } = header;
  const bpp = CHANNELS[colourType];
  const stride = width * bpp;
  const expected = height * (stride + 1);
  const raw = inflateSync(idat.length === 1 ? idat[0] : Buffer.concat(idat), { maxOutputLength: expected + 1 });
  if (raw.length !== expected) throw new Error('IDAT inflates to wrong size');
  const samples = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const ft = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const o = y * stride;
    const p = o - stride;
    if (ft === 0) samples.set(raw.subarray(src, src + stride), o);
    else if (ft === 1) {
      for (let i = 0; i < stride; i++) samples[o + i] = raw[src + i] + (i >= bpp ? samples[o + i - bpp] : 0);
    } else if (ft === 2) {
      for (let i = 0; i < stride; i++) samples[o + i] = raw[src + i] + (y > 0 ? samples[p + i] : 0);
    } else if (ft === 3) {
      for (let i = 0; i < stride; i++) samples[o + i] = raw[src + i] + (((i >= bpp ? samples[o + i - bpp] : 0) + (y > 0 ? samples[p + i] : 0)) >> 1);
    } else if (ft === 4) {
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? samples[o + i - bpp] : 0;
        const b = y > 0 ? samples[p + i] : 0;
        const c = y > 0 && i >= bpp ? samples[p + i - bpp] : 0;
        samples[o + i] = raw[src + i] + paeth(a, b, c);
      }
    } else throw new Error(`bad filter ${ft}`);
  }
  const n = width * height;
  const rgba = new Uint8Array(n * 4);
  if (colourType === 6) rgba.set(samples);
  else if (colourType === 2) {
    const key = trns === null ? -1 : (trns[1] << 16) | (trns[3] << 8) | trns[5];
    for (let i = 0, s = 0, d = 0; i < n; i++, s += 3, d += 4) {
      rgba[d] = samples[s];
      rgba[d + 1] = samples[s + 1];
      rgba[d + 2] = samples[s + 2];
      rgba[d + 3] = ((samples[s] << 16) | (samples[s + 1] << 8) | samples[s + 2]) === key ? 0 : 255;
    }
  } else if (colourType === 0) {
    const key = trns === null ? -1 : trns[1];
    for (let i = 0, d = 0; i < n; i++, d += 4) {
      const g = samples[i];
      rgba[d] = rgba[d + 1] = rgba[d + 2] = g;
      rgba[d + 3] = g === key ? 0 : 255;
    }
  } else if (colourType === 4) {
    for (let i = 0, s = 0, d = 0; i < n; i++, s += 2, d += 4) {
      rgba[d] = rgba[d + 1] = rgba[d + 2] = samples[s];
      rgba[d + 3] = samples[s + 1];
    }
  } else {
    const entries = palette.length / 3;
    const lut = new Uint8Array(entries * 4);
    for (let e = 0; e < entries; e++) {
      lut[e * 4] = palette[e * 3];
      lut[e * 4 + 1] = palette[e * 3 + 1];
      lut[e * 4 + 2] = palette[e * 3 + 2];
      lut[e * 4 + 3] = trns !== null && e < trns.length ? trns[e] : 255;
    }
    for (let i = 0, d = 0; i < n; i++, d += 4) {
      const e = samples[i];
      if (e >= entries) throw new Error('palette index out of range');
      rgba[d] = lut[e * 4];
      rgba[d + 1] = lut[e * 4 + 1];
      rgba[d + 2] = lut[e * 4 + 2];
      rgba[d + 3] = lut[e * 4 + 3];
    }
  }
  return { width, height, rgba };
}

// ------------------------------------------------------- image analysis ----

function wordsOf(rgba) {
  const at = rgba.byteOffset % 4 === 0 ? rgba : rgba.slice();
  return new Uint32Array(at.buffer, at.byteOffset, at.length >>> 2);
}

// opaque? grey? colours (<=256) with counts?
function analyse(rgba) {
  const n = rgba.length >>> 2;
  const u32 = wordsOf(rgba);
  let opaque = true;
  let grey = true;
  const counts = new Map();
  let many = false;
  for (let i = 0, d = 0; i < n; i++, d += 4) {
    if (rgba[d + 3] !== 255) opaque = false;
    if (rgba[d] !== rgba[d + 1] || rgba[d] !== rgba[d + 2]) grey = false;
    if (!many) {
      const c = u32[i];
      const k = counts.get(c);
      if (k === undefined) {
        if (counts.size === 256) many = true;
        else counts.set(c, 1);
      } else counts.set(c, k + 1);
    }
  }
  const colours = many
    ? null
    : [...counts.keys()].map((c) => {
        const b = new Uint8Array(Uint32Array.of(c).buffer);
        return { rgba: [b[0], b[1], b[2], b[3]], word: c, count: counts.get(c) };
      });
  return { opaque, grey, colours };
}

// The one fully-transparent value the image may key by tRNS instead of an alpha channel.
function transparentKey(rgba, grey) {
  let key = -1;
  for (let d = 0; d < rgba.length; d += 4) {
    const a = rgba[d + 3];
    if (a === 255) continue;
    if (a !== 0) return null;
    const v = grey ? rgba[d] : (rgba[d] << 16) | (rgba[d + 1] << 8) | rgba[d + 2];
    if (key === -1) key = v;
    else if (key !== v) return null;
  }
  if (key === -1) return null;
  for (let d = 0; d < rgba.length; d += 4) {
    if (rgba[d + 3] !== 255) continue;
    const v = grey ? rgba[d] : (rgba[d] << 16) | (rgba[d + 1] << 8) | rgba[d + 2];
    if (v === key) return null;
  }
  return key;
}

function samplesOf(rgba, ct) {
  const n = rgba.length >>> 2;
  if (ct === 6) return rgba;
  const ch = ct === 0 ? 1 : ct === 4 ? 2 : 3;
  const out = new Uint8Array(n * ch);
  for (let i = 0, d = 0, s = 0; i < n; i++, d += 4, s += ch) {
    if (ct === 0) out[s] = rgba[d];
    else if (ct === 4) {
      out[s] = rgba[d];
      out[s + 1] = rgba[d + 3];
    } else {
      out[s] = rgba[d];
      out[s + 1] = rgba[d + 1];
      out[s + 2] = rgba[d + 2];
    }
  }
  return out;
}

function paletteOrder(colours, order) {
  const lum = (c) => 299 * c.rgba[0] + 587 * c.rgba[1] + 114 * c.rgba[2];
  return [...colours].sort((x, y) => {
    const ta = x.rgba[3] === 255 ? 1 : 0;
    const tb = y.rgba[3] === 255 ? 1 : 0;
    if (ta !== tb) return ta - tb;
    if (ta === 0 && x.rgba[3] !== y.rgba[3]) return x.rgba[3] - y.rgba[3];
    if (order === 'luminance') return lum(x) - lum(y) || x.word - y.word;
    return y.count - x.count || x.word - y.word;
  });
}

function paletteForm(rgba, colours, order) {
  const entries = paletteOrder(colours, order);
  const index = new Map(entries.map((c, i) => [c.word, i]));
  const plte = new Uint8Array(entries.length * 3);
  let transparent = 0;
  entries.forEach((c, i) => {
    plte[i * 3] = c.rgba[0];
    plte[i * 3 + 1] = c.rgba[1];
    plte[i * 3 + 2] = c.rgba[2];
    if (c.rgba[3] !== 255) transparent = i + 1;
  });
  const trns = transparent === 0 ? null : Uint8Array.from(entries.slice(0, transparent), (c) => c.rgba[3]);
  const n = rgba.length >>> 2;
  const u32 = wordsOf(rgba);
  const indices = new Uint8Array(n);
  for (let i = 0; i < n; i++) indices[i] = index.get(u32[i]);
  return { plte, trns, indices };
}

// Candidate colour forms for an image, each {colourType, bpp, samples, plte, trns}.
function formsOf(rgba) {
  const { opaque, grey, colours } = analyse(rgba);
  const forms = [];
  if (colours !== null) {
    for (const order of ['count', 'luminance']) {
      const p = paletteForm(rgba, colours, order);
      forms.push({ colourType: 3, bpp: 1, samples: p.indices, plte: p.plte, trns: p.trns, order });
    }
    if (!grey) return forms;
  }
  const key = opaque ? null : transparentKey(rgba, grey);
  let ct;
  let trns = null;
  if (grey) {
    ct = opaque || key !== null ? 0 : 4;
    if (key !== null) trns = Uint8Array.of(0, key);
  } else {
    ct = opaque || key !== null ? 2 : 6;
    if (key !== null) trns = Uint8Array.of(0, key >>> 16, 0, (key >>> 8) & 0xff, 0, key & 0xff);
  }
  const bpp = { 0: 1, 2: 3, 4: 2, 6: 4 }[ct];
  forms.push({ colourType: ct, bpp, samples: samplesOf(rgba, ct), plte: null, trns, order: 'channels' });
  return forms;
}

const chunkBytes = (form) =>
  (form.plte === null ? 0 : 12 + form.plte.length) + (form.trns === null ? 0 : 12 + form.trns.length);

// ------------------------------------------------------------ filtering ----

function filterRow(type, cur, prev, bpp, out) {
  const n = cur.length;
  if (type === 0) out.set(cur);
  else if (type === 1) {
    for (let i = 0; i < n; i++) out[i] = cur[i] - (i >= bpp ? cur[i - bpp] : 0);
  } else if (type === 2) {
    for (let i = 0; i < n; i++) out[i] = cur[i] - (prev === null ? 0 : prev[i]);
  } else if (type === 3) {
    for (let i = 0; i < n; i++) out[i] = cur[i] - (((i >= bpp ? cur[i - bpp] : 0) + (prev === null ? 0 : prev[i])) >> 1);
  } else {
    for (let i = 0; i < n; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev === null ? 0 : prev[i];
      const c = prev !== null && i >= bpp ? prev[i - bpp] : 0;
      out[i] = cur[i] - paeth(a, b, c);
    }
  }
}

function signedSum(row) {
  let s = 0;
  for (let i = 0; i < row.length; i++) {
    const v = row[i];
    s += v < 128 ? v : 256 - v;
  }
  return s;
}

const BRUTE_CONTEXT = 32768;
const BRUTE_LEVEL = 4;

function pairsOf(row, seen, stamp) {
  let n = 0;
  for (let i = 1; i < row.length; i++) {
    const pair = (row[i - 1] << 8) | row[i];
    if (seen[pair] !== stamp) {
      seen[pair] = stamp;
      n++;
    }
  }
  return n;
}

// Filtered raw data for a form's samples under `choice`:
// a fixed filter 0..4, or 'minsum' / 'pairs' / 'brute' per-row adaptive choice.
function filtered(samples, width, height, bpp, choice) {
  const stride = width * bpp;
  const raw = new Uint8Array(height * (stride + 1));
  const trial = Array.from({ length: 5 }, (_, t) => {
    const row = new Uint8Array(stride + 1);
    row[0] = t;
    return row;
  });
  const seen = new Uint32Array(65536);
  let stamp = 0;
  for (let y = 0; y < height; y++) {
    const cur = samples.subarray(y * stride, (y + 1) * stride);
    const prev = y === 0 ? null : samples.subarray((y - 1) * stride, y * stride);
    const at = y * (stride + 1);
    if (typeof choice === 'number') {
      raw[at] = choice;
      filterRow(choice, cur, prev, bpp, raw.subarray(at + 1, at + 1 + stride));
      continue;
    }
    const before = raw.subarray(Math.max(0, at - BRUTE_CONTEXT), at);
    let type = 0;
    let best = Infinity;
    for (let t = 0; t < 5; t++) {
      filterRow(t, cur, prev, bpp, trial[t].subarray(1));
      let cost;
      if (choice === 'minsum') cost = signedSum(trial[t].subarray(1));
      else if (choice === 'pairs') cost = pairsOf(trial[t].subarray(1), seen, ++stamp);
      else
        cost = deflateSync(
          trial[t],
          before.length === 0
            ? { level: BRUTE_LEVEL, memLevel: 9 }
            : { level: BRUTE_LEVEL, memLevel: 9, dictionary: before },
        ).length;
      if (cost < best) {
        best = cost;
        type = t;
      }
    }
    raw.set(trial[type], at);
  }
  return raw;
}

// ------------------------------------------------------- zlib backends ----

// Best of several zlib settings for `data` (a full zlib stream).
function zlibBest(data) {
  let best = null;
  for (const strategy of [constants.Z_DEFAULT_STRATEGY, constants.Z_FILTERED, constants.Z_RLE]) {
    const s = deflateSync(data, { level: 9, memLevel: 9, strategy });
    if (best === null || s.length < best.length) best = s;
  }
  return best;
}

// Screen of a filtered stream (level 6, like the scale compressor) for ranking
// candidates. Level 1 mis-ranks: it picked a 4.5% worse candidate on i002.
function zlibScreen(data) {
  return deflateSync(data, { level: 6, memLevel: 8 }).length;
}

function pngOfForm(width, height, form, idat) {
  const chunks = [['IHDR', ihdrOf(width, height, form.colourType)]];
  if (form.plte !== null) chunks.push(['PLTE', form.plte]);
  if (form.trns !== null) chunks.push(['tRNS', form.trns]);
  chunks.push(['IDAT', idat]);
  chunks.push(['IEND', new Uint8Array(0)]);
  return pngOf(chunks);
}

// Zopfli-style optimal-parsing DEFLATE encoder (from scratch, concepts only).
// Hash-chain LZ77 + DP shortest-path parse + per-block length-limited Huffman
// (package-merge) + dynamic/fixed block choice. Deterministic, no I/O.

// ---- DEFLATE tables ----
const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

function lengthCode(len) {
  let lo = 0, hi = 28;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (LEN_BASE[mid] <= len) lo = mid; else hi = mid - 1; }
  return 257 + lo;
}
function distCode(d) {
  let lo = 0, hi = 29;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (DIST_BASE[mid] <= d) lo = mid; else hi = mid - 1; }
  return lo;
}

// Lengths at which the length code changes (plus 258): all lengths worth trying in DP.
const CANDIDATE_LENS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];

// ---- length-limited Huffman code lengths via boundary package-merge ----
// The bounded package-merge algorithm (Katajainen/Moffat/Turpin): each level
// streams chains in increasing weight, always taking the lighter of the next
// package (two lookahead chains of the level below) or the next unused leaf.
// The final chain of the last level holds the counts from which each
// symbol's code length is read off. Written from the algorithm's description,
// not from any existing implementation.
function codeLengths(freqs, maxLen) {
  const n = freqs.length;
  const out = new Uint8Array(n);
  const leaves = [];
  for (let s = 0; s < n; s++) if (freqs[s] > 0) leaves.push({ w: freqs[s], sym: s });
  const numsymbols = leaves.length;
  if (numsymbols === 0) return out;
  if (numsymbols === 1) { out[leaves[0].sym] = 1; return out; }
  if (numsymbols === 2) { out[leaves[0].sym] = 1; out[leaves[1].sym] = 1; return out; }
  if ((1 << maxLen) < numsymbols) throw new Error('too many symbols for maxLen');
  leaves.sort((a, b) => a.w - b.w || a.sym - b.sym);
  const maxbits = Math.min(maxLen, numsymbols - 1);
  // Two lookahead chains per level; every level starts on the two lightest leaves.
  const node0 = { w: leaves[0].w, count: 1, tail: null };
  const node1 = { w: leaves[1].w, count: 2, tail: null };
  const lists = [];
  for (let i = 0; i < maxbits; i++) lists.push([node0, node1]);

  function boundaryPM(index) {
    const lastcount = lists[index][1].count;
    if (index === 0 && lastcount >= numsymbols) return;
    const oldchain = lists[index][1];
    let newchain;
    if (index === 0) {
      newchain = { w: leaves[lastcount].w, count: lastcount + 1, tail: null };
    } else {
      const sum = lists[index - 1][0].w + lists[index - 1][1].w;
      if (lastcount < numsymbols && sum > leaves[lastcount].w) {
        // The next leaf is lighter than packaging: insert it as a chain.
        newchain = { w: leaves[lastcount].w, count: lastcount + 1, tail: oldchain.tail };
      } else {
        // Package the two lookahead chains of the level below.
        newchain = { w: sum, count: lastcount, tail: lists[index - 1][1] };
        boundaryPM(index - 1);
        boundaryPM(index - 1);
      }
    }
    lists[index][0] = oldchain;
    lists[index][1] = newchain;
  }

  function boundaryPMFinal(index) {
    const lastcount = lists[index][1].count;
    const sum = lists[index - 1][0].w + lists[index - 1][1].w;
    if (lastcount < numsymbols && sum > leaves[lastcount].w) {
      lists[index][1] = { w: leaves[lastcount].w, count: lastcount + 1, tail: lists[index][1].tail };
    } else {
      lists[index][1].tail = lists[index - 1][1];
    }
  }

  // The last level needs 2 * numsymbols - 2 chains; two exist already.
  const runs = 2 * numsymbols - 4;
  for (let i = 0; i < runs - 1; i++) boundaryPM(maxbits - 1);
  boundaryPMFinal(maxbits - 1);

  // Read the lengths off the final chain: walking its tails gives counts
  // c0 > c1 > ... ; leaves with sorted index in (c_{j+1}, c_j] get length j+1.
  const chainCounts = [];
  for (let node = lists[maxbits - 1][1]; node; node = node.tail) chainCounts.push(node.count);
  let val = chainCounts[0];
  let value = 1;
  for (let j = 0; j < chainCounts.length; j++) {
    const lo = j + 1 < chainCounts.length ? chainCounts[j + 1] : 0;
    while (val > lo) {
      out[leaves[val - 1].sym] = value;
      val--;
    }
    value++;
  }
  return out;
}

// Canonical Huffman codes from lengths: returns {codes: Uint32Array, lens: Uint8Array}.
function canonicalCodes(lengths) {
  const n = lengths.length;
  const maxLen = Math.max(0, ...lengths);
  const blCount = new Uint32Array(maxLen + 1);
  for (let i = 0; i < n; i++) if (lengths[i] > 0) blCount[lengths[i]]++;
  const nextCode = new Uint32Array(maxLen + 1);
  let code = 0;
  for (let bits = 1; bits <= maxLen; bits++) {
    code = (code + blCount[bits - 1]) << 1;
    nextCode[bits] = code;
  }
  const codes = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const len = lengths[i];
    if (len > 0) codes[i] = nextCode[len]++;
  }
  return { codes, lens: lengths };
}

function reverseBits(code, len) {
  let r = 0;
  for (let i = 0; i < len; i++) { r = (r << 1) | (code & 1); code >>= 1; }
  return r;
}

// ---- bit writer (LSB-first into bytes) ----
class BitWriter {
  constructor(size) {
    this.buf = new Uint8Array(size);
    this.pos = 0;
    this.bitbuf = 0;
    this.bitcnt = 0;
  }
  writeBits(value, len) {
    this.bitbuf |= (value << this.bitcnt) >>> 0;
    this.bitcnt += len;
    while (this.bitcnt >= 8) {
      this.buf[this.pos++] = this.bitbuf & 0xff;
      this.bitbuf >>>= 8;
      this.bitcnt -= 8;
    }
  }
  writeCode(code, len) {
    this.writeBits(reverseBits(code, len), len);
  }
  align() {
    if (this.bitcnt > 0) {
      this.buf[this.pos++] = this.bitbuf & 0xff;
      this.bitbuf = 0;
      this.bitcnt = 0;
    }
  }
}

// ---- LZ77 match finder (hash chains over the whole stream) ----
const HASH_BITS = 15;
const HASH_SIZE = 1 << HASH_BITS;
const HASH_MASK = HASH_SIZE - 1;
const WINDOW = 32768;
const MAX_MATCH = 258;
const MIN_MATCH = 3;

function hash3(d, i) {
  return (((d[i] << 10) ^ (d[i + 1] << 5) ^ d[i + 2]) & HASH_MASK) >>> 0;
}

class MatchFinder {
  constructor(data) {
    this.data = data;
    const n = data.length;
    this.prev = new Int32Array(n);
    const head = new Int32Array(HASH_SIZE).fill(-1);
    for (let i = 0; i < n; i++) {
      if (i + 2 < n) {
        const h = hash3(data, i);
        this.prev[i] = head[h];
        head[h] = i;
      } else this.prev[i] = -1;
    }
    this.head = head;
  }
  // Longest match at position i (distance, length). Chain-limited, with the
  // "good enough" early reduction like zlib.
  longestMatch(i, chainLimit) {
    const d = this.data;
    const n = d.length;
    const maxLen = Math.min(MAX_MATCH, n - i);
    if (maxLen < MIN_MATCH) return [0, 0];
    let best = 0;
    let bestDist = 0;
    let j = this.prev[i];
    const limit = Math.max(0, i - WINDOW);
    let chain = 0;
    let limit2 = chainLimit;
    while (j >= limit && chain < limit2) {
      // To beat `best`, the byte at offset best must match.
      if (best >= MIN_MATCH && (i + best >= n || d[j + best] !== d[i + best])) {
        j = this.prev[j];
        chain++;
        continue;
      }
      if (d[j] !== d[i] || d[j + 1] !== d[i + 1] || d[j + 2] !== d[i + 2]) {
        j = this.prev[j];
        chain++;
        continue;
      }
      let len = MIN_MATCH;
      while (len < maxLen && d[i + len] === d[j + len]) len++;
      if (len > best) {
        best = len;
        bestDist = i - j;
        if (len >= MAX_MATCH) break;
        if (len >= 128) limit2 = 8;
        else if (len >= 32) limit2 = 32;
      }
      j = this.prev[j];
      chain++;
    }
    return [bestDist, best];
  }
}

// ---- token stream helpers ----
function lengthCosts(litLenLens) {
  // Cost in bits (exact integers) of encoding a match of length L, excluding distance.
  const c = new Int32Array(MAX_MATCH + 1);
  for (let L = MIN_MATCH; L <= MAX_MATCH; L++) {
    const sym = lengthCode(L);
    c[L] = litLenLens[sym] + LEN_EXTRA[sym - 257];
  }
  return c;
}
function distCosts(distLens) {
  const c = new Int32Array(WINDOW + 1);
  for (let dist = 1; dist <= WINDOW; dist++) {
    const sym = distCode(dist);
    c[dist] = distLens[sym] + DIST_EXTRA[sym];
  }
  return c;
}

// Fixed Huffman lengths.
const FIXED_LITLEN = new Uint8Array(288);
for (let i = 0; i < 288; i++) FIXED_LITLEN[i] = i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8;
const FIXED_DIST = new Uint8Array(30).fill(5);

// DP optimal parse of data[s..e) given lit/length + distance bit costs.
// mlen/mdist: per-position best match (arrays indexed by absolute position).
// Returns tokens as flat arrays: tokIsMatch (0 literal / 1 match), tokSym (literal byte or length),
// tokDist (distance, 0 for literal). Also returns frequencies.
function optimalParse(data, s, e, litCost, lenCost, distCost, mlen, mdist) {
  // All costs are exact integer bit counts, so the DP runs on Int32.
  const n = e - s;
  const INF = 1e9;
  const cost = new Int32Array(n + 1).fill(INF);
  const tokLen = new Uint16Array(n + 1);
  const tokDist = new Int32Array(n + 1);
  cost[0] = 0;
  for (let i = 0; i < n; i++) {
    const c = cost[i];
    if (c >= INF) continue;
    const p = s + i;
    // Literal.
    const nc = c + litCost[data[p]];
    if (nc < cost[i + 1]) {
      cost[i + 1] = nc;
      tokLen[i + 1] = 1;
      tokDist[i + 1] = 0;
    }
    // Matches.
    const ml = mlen[i];
    if (ml >= MIN_MATCH) {
      const dc = distCost[mdist[i]];
      for (const L of CANDIDATE_LENS) {
        if (L > ml) break;
        const nc2 = c + lenCost[L] + dc;
        if (nc2 < cost[i + L]) {
          cost[i + L] = nc2;
          tokLen[i + L] = L;
          tokDist[i + L] = mdist[i];
        }
      }
      if (ml !== 258 && !CANDIDATE_LENS.includes(ml)) {
        const nc2 = c + lenCost[ml] + dc;
        if (nc2 < cost[i + ml]) {
          cost[i + ml] = nc2;
          tokLen[i + ml] = ml;
          tokDist[i + ml] = mdist[i];
        }
      }
    }
  }
  // Backtrack.
  const isMatch = [];
  const sym = [];
  const dist = [];
  let i = n;
  while (i > 0) {
    const L = tokLen[i];
    const D = tokDist[i];
    if (L === 1 && D === 0) {
      isMatch.push(0);
      sym.push(data[s + i - 1]);
      dist.push(0);
    } else {
      isMatch.push(1);
      sym.push(L);
      dist.push(D);
    }
    i -= L;
  }
  isMatch.reverse();
  sym.reverse();
  dist.reverse();
  return { isMatch, sym, dist, cost: cost[n] };
}

function frequenciesFromTokens(t) {
  const litFreq = new Uint32Array(288);
  const distFreq = new Uint32Array(30);
  for (let k = 0; k < t.isMatch.length; k++) {
    if (t.isMatch[k] === 0) litFreq[t.sym[k]]++;
    else {
      litFreq[lengthCode(t.sym[k])]++;
      distFreq[distCode(t.dist[k])]++;
    }
  }
  litFreq[256]++; // end of block
  return { litFreq, distFreq };
}

// RLE-encode code lengths (lit/len lengths followed by dist lengths) into
// symbols 0..18, returning the symbol array.
function rleLengths2(lengths) {
  const out = [];
  const n = lengths.length;
  let i = 0;
  while (i < n) {
    const v = lengths[i];
    let run = 1;
    while (i + run < n && lengths[i + run] === v) run++;
    let left = run;
    if (v === 0) {
      while (left >= 11) {
        const take = Math.min(left, 138);
        out.push(18, take - 11);
        left -= take;
      }
      if (left >= 3) {
        out.push(17, left - 3);
        left = 0;
      }
      while (left-- > 0) out.push(0);
    } else {
      out.push(v);
      left--;
      while (left >= 3) {
        const take = Math.min(left, 6);
        out.push(16, take - 3);
        left -= take;
      }
      while (left-- > 0) out.push(v);
    }
    i += run;
  }
  return out;
}

const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

// Emit one block. tokens: {isMatch, sym, dist}. litLens/distLens: code lengths.
// Returns bits written (excluding BFINAL/BTYPE bits counted by caller via writer state).
function emitDynamicBlock(w, isLast, tokens, litLens, distLens) {
  const allLens = new Uint8Array(286 + 30);
  allLens.set(litLens.subarray(0, 286), 0);
  allLens.set(distLens.subarray(0, 30), 286);
  // Trim trailing zero lengths.
  let hlit = 286;
  while (hlit > 257 && allLens[hlit - 1] === 0) hlit--;
  let hdist = 30;
  while (hdist > 1 && allLens[286 + hdist - 1] === 0) hdist--;
  // The lengths to RLE-encode: the first hlit lit/len lengths, then the first
  // hdist distance lengths (a concatenation, NOT a contiguous slice: the
  // distance lengths live at allLens[286..], past the unused lit entries).
  const trimmed = new Uint8Array(hlit + hdist);
  trimmed.set(litLens.subarray(0, hlit), 0);
  trimmed.set(distLens.subarray(0, hdist), hlit);
  const rle = rleLengths2(trimmed);
  // Code-length code frequencies (symbols 0..18; extra-bit values are not symbols).
  const clFreq = new Uint32Array(19);
  for (let k = 0; k < rle.length; k += rle[k] >= 16 ? 2 : 1) clFreq[rle[k]]++;
  let clLens = codeLengths(clFreq, 7);
  // A Huffman code needs at least two symbols: add a dummy if needed.
  let nz = 0;
  for (let s = 0; s < 19; s++) if (clLens[s] > 0) nz++;
  if (nz < 2) {
    for (let s = 0; s < 19; s++) {
      if (clLens[s] === 0) { clLens[s] = 1; nz++; if (nz >= 2) break; }
    }
  }
  const clCode = canonicalCodes(clLens);
  // HCLEN: last nonzero in CL_ORDER, at least 4 entries.
  let hclen = 19;
  while (hclen > 4 && clLens[CL_ORDER[hclen - 1]] === 0) hclen--;
  // Header.
  w.writeBits(isLast ? 1 : 0, 1);
  w.writeBits(2, 2); // dynamic
  w.writeBits(hlit - 257, 5);
  w.writeBits(hdist - 1, 5);
  w.writeBits(hclen - 4, 4);
  for (let k = 0; k < hclen; k++) w.writeBits(clLens[CL_ORDER[k]], 3);
  // RLE-encoded lengths.
  for (let k = 0; k < rle.length;) {
    const s = rle[k];
    w.writeCode(clCode.codes[s], clLens[s]);
    if (s === 16) { w.writeBits(rle[k + 1], 2); k += 2; }
    else if (s === 17) { w.writeBits(rle[k + 1], 3); k += 2; }
    else if (s === 18) { w.writeBits(rle[k + 1], 7); k += 2; }
    else k += 1;
  }
  // Data.
  const litCode = canonicalCodes(litLens);
  const distCodeTbl = canonicalCodes(distLens);
  for (let k = 0; k < tokens.isMatch.length; k++) {
    if (tokens.isMatch[k] === 0) {
      const s = tokens.sym[k];
      w.writeCode(litCode.codes[s], litLens[s]);
    } else {
      const L = tokens.sym[k];
      const lc = lengthCode(L);
      w.writeCode(litCode.codes[lc], litLens[lc]);
      w.writeBits(L - LEN_BASE[lc - 257], LEN_EXTRA[lc - 257]);
      const D = tokens.dist[k];
      const dc = distCode(D);
      w.writeCode(distCodeTbl.codes[dc], distLens[dc]);
      w.writeBits(D - DIST_BASE[dc], DIST_EXTRA[dc]);
    }
  }
  w.writeCode(litCode.codes[256], litLens[256]); // end of block
}

function emitFixedBlock(w, isLast, tokens) {
  w.writeBits(isLast ? 1 : 0, 1);
  w.writeBits(1, 2); // fixed
  const litCode = canonicalCodes(FIXED_LITLEN);
  const distCodeTbl = canonicalCodes(FIXED_DIST);
  for (let k = 0; k < tokens.isMatch.length; k++) {
    if (tokens.isMatch[k] === 0) {
      const s = tokens.sym[k];
      w.writeCode(litCode.codes[s], FIXED_LITLEN[s]);
    } else {
      const L = tokens.sym[k];
      const lc = lengthCode(L);
      w.writeCode(litCode.codes[lc], FIXED_LITLEN[lc]);
      w.writeBits(L - LEN_BASE[lc - 257], LEN_EXTRA[lc - 257]);
      const D = tokens.dist[k];
      const dc = distCode(D);
      w.writeCode(distCodeTbl.codes[dc], FIXED_DIST[dc]);
      w.writeBits(D - DIST_BASE[dc], DIST_EXTRA[dc]);
    }
  }
  w.writeCode(litCode.codes[256], FIXED_LITLEN[256]);
}

// Bit cost of emitting tokens with fixed Huffman codes.
function fixedCost(tokens) {
  let bits = 3;
  for (let k = 0; k < tokens.isMatch.length; k++) {
    if (tokens.isMatch[k] === 0) bits += FIXED_LITLEN[tokens.sym[k]];
    else {
      const lc = lengthCode(tokens.sym[k]);
      bits += FIXED_LITLEN[lc] + LEN_EXTRA[lc - 257];
      const dc = distCode(tokens.dist[k]);
      bits += FIXED_DIST[dc] + DIST_EXTRA[dc];
    }
  }
  bits += FIXED_LITLEN[256];
  return bits;
}

// Bit cost of emitting tokens with dynamic Huffman codes (header + data).
function dynamicCost(tokens, litLens, distLens) {
  const allLens = new Uint8Array(286 + 30);
  allLens.set(litLens.subarray(0, 286), 0);
  allLens.set(distLens.subarray(0, 30), 286);
  let hlit = 286;
  while (hlit > 257 && allLens[hlit - 1] === 0) hlit--;
  let hdist = 30;
  while (hdist > 1 && allLens[286 + hdist - 1] === 0) hdist--;
  const trimmed = new Uint8Array(hlit + hdist);
  trimmed.set(litLens.subarray(0, hlit), 0);
  trimmed.set(distLens.subarray(0, hdist), hlit);
  const rle = rleLengths2(trimmed);
  const clFreq = new Uint32Array(19);
  for (let k = 0; k < rle.length; k += rle[k] >= 16 ? 2 : 1) clFreq[rle[k]]++;
  const clLens = codeLengths(clFreq, 7);
  let nz = 0;
  for (let s = 0; s < 19; s++) if (clLens[s] > 0) nz++;
  if (nz < 2) nz = 2; // dummy added in emission; approximate header cost
  let hclen = 19;
  while (hclen > 4 && clLens[CL_ORDER[hclen - 1]] === 0) hclen--;
  let bits = 3 + 5 + 5 + 4 + 3 * hclen;
  for (let k = 0; k < rle.length;) {
    const s = rle[k];
    bits += clLens[s];
    if (s === 16) { bits += 2; k += 2; }
    else if (s === 17) { bits += 3; k += 2; }
    else if (s === 18) { bits += 7; k += 2; }
    else k += 1;
  }
  for (let k = 0; k < tokens.isMatch.length; k++) {
    if (tokens.isMatch[k] === 0) bits += litLens[tokens.sym[k]];
    else {
      const lc = lengthCode(tokens.sym[k]);
      bits += litLens[lc] + LEN_EXTRA[lc - 257];
      const dc = distCode(tokens.dist[k]);
      bits += distLens[dc] + DIST_EXTRA[dc];
    }
  }
  bits += litLens[256];
  return bits;
}


const BLOCK_SIZE = 262144;
const CHAIN_LIMIT = 256;
const DP_ITERATIONS = 3;

// Compress `data` (Uint8Array) to a full zlib stream. Options: {blockSize, chainLimit, iterations}.
function customDeflate(data, opts = {}) {
  const blockSize = opts.blockSize ?? BLOCK_SIZE;
  const chainLimit = opts.chainLimit ?? CHAIN_LIMIT;
  const iterations = opts.iterations ?? DP_ITERATIONS;
  const finder = new MatchFinder(data);
  const out = new BitWriter(data.length + 65536);
  out.buf[out.pos++] = 0x78;
  out.buf[out.pos++] = 0xda;
  const n = data.length;
  const nBlocks = Math.max(1, Math.ceil(n / blockSize));
  for (let b = 0; b < nBlocks; b++) {
    const s = b * blockSize;
    const e = Math.min(n, s + blockSize);
    const isLast = b === nBlocks - 1;
    // Per-position best matches for this block.
    const mlen = new Uint16Array(e - s);
    const mdist = new Int32Array(e - s);
    for (let i = s; i < e; i++) {
      const [dist, len] = finder.longestMatch(i, chainLimit);
      mlen[i - s] = len;
      mdist[i - s] = dist;
    }
    // Iterative optimal parsing: start from fixed costs.
    let litLens = FIXED_LITLEN;
    let distLens = FIXED_DIST;
    let tokens = null;
    for (let it = 0; it < iterations; it++) {
      const litCost = new Int32Array(256);
      for (let i = 0; i < 256; i++) litCost[i] = litLens[i];
      const lenC = lengthCosts(litLens);
      const distC = distCosts(distLens);
      const parsed = optimalParse(data, s, e, litCost, lenC, distC, mlen, mdist);
      tokens = { isMatch: parsed.isMatch, sym: parsed.sym, dist: parsed.dist };
      const { litFreq, distFreq } = frequenciesFromTokens(tokens);
      litLens = codeLengths(litFreq, 15);
      distLens = codeLengths(distFreq, 15);
      // A Huffman code needs at least two symbols; add a dummy if needed.
      let nzL = 0, nzD = 0;
      for (let i = 0; i < 288; i++) if (litLens[i] > 0) nzL++;
      for (let i = 0; i < 30; i++) if (distLens[i] > 0) nzD++;
      if (nzL < 2) { for (let i = 0; i < 288; i++) if (litLens[i] === 0) { litLens[i] = 1; nzL++; if (nzL >= 2) break; } }
      if (nzD < 2) { for (let i = 0; i < 30; i++) if (distLens[i] === 0) { distLens[i] = 1; nzD++; if (nzD >= 2) break; } }
    }
    // Emit dynamic or fixed, whichever is smaller.
    if (dynamicCost(tokens, litLens, distLens) <= fixedCost(tokens)) {
      emitDynamicBlock(out, isLast, tokens, litLens, distLens);
    } else {
      emitFixedBlock(out, isLast, tokens);
    }
  }
  out.align();
  const ad = adler32(data);
  out.buf[out.pos++] = (ad >>> 24) & 0xff;
  out.buf[out.pos++] = (ad >>> 16) & 0xff;
  out.buf[out.pos++] = (ad >>> 8) & 0xff;
  out.buf[out.pos++] = ad & 0xff;
  return out.buf.subarray(0, out.pos);
}


// ---------------------------------------------------- per-image pipeline ----

// Filter choices screened per form kind. Fixed filters 1/2/4 never won on the
// practice set (minsum covers them), so they are dropped to save screen time.
const FILTER_CHOICES = {
  paletteCount: [0],
  paletteLuminance: [0, 'minsum', 'brute'],
  channels: [0, 'minsum', 'pairs', 'brute'],
};

// Encode one decoded image to its smallest PNG bytes:
// screen every (form, filter) candidate at zlib level 6, then final-encode the
// winner with the custom optimal-parsing deflate (and zlib level 9 as a
// safety net), and the runner-up with zlib level 9 in case the screen
// mis-ranked it. The smallest PNG wins.
function encodeImage(rgba, width, height) {
  const forms = formsOf(rgba);
  const cands = [];
  for (const form of forms) {
    const choices = form.colourType === 3
      ? form.order === 'count' ? FILTER_CHOICES.paletteCount : FILTER_CHOICES.paletteLuminance
      : FILTER_CHOICES.channels;
    for (const choice of choices) {
      const data = filtered(form.samples, width, height, form.bpp, choice);
      const est = zlibScreen(data) + chunkBytes(form);
      cands.push({ form, choice, data, est });
    }
  }
  cands.sort((a, b) => a.est - b.est);
  const [first, second] = cands;
  let best = null;
  const consider = (png) => {
    if (best === null || png.length < best.length) best = png;
  };
  consider(pngOfForm(width, height, first.form, customDeflate(first.data)));
  consider(pngOfForm(width, height, first.form, zlibBest(first.data)));
  if (second) consider(pngOfForm(width, height, second.form, zlibBest(second.data)));
  return best;
}

// ------------------------------------------------------------------ main ----

for (const id of readdirSync(INPUT_DIR).sort()) {
  const image = decodePng(new Uint8Array(readFileSync(join(INPUT_DIR, id, 'image.png'))));
  mkdirSync(join(OUTPUT_DIR, id), { recursive: true });
  writeFileSync(join(OUTPUT_DIR, id, 'image.png'), encodeImage(image.rgba, image.width, image.height));
}
