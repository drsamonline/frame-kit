/* global module */
/* frame-kit — the shared transfer-frame core for drsamonline apps.
 *
 * One file, no build step, no dependencies. It provides the *framing* layer that
 * the optical-transfer apps (helioprism, blinkcode-ai, BLINKTRANSFER) share,
 * sitting above the fountain codec in `optical-kit`:
 *
 *   - a self-describing 22-byte header (magic, version, transferId, k, blockSize,
 *     totalLength, payload CRC-32, symbolId, header CRC-16) with strict
 *     validation of untrusted input;
 *   - a rateless `FountainCollector` that locks onto a stream mid-flight,
 *     tolerates duplicates and out-of-order symbols, restarts on a new transfer
 *     id, and verifies the payload checksum on assemble;
 *   - the small byte/checksum utilities the frame and its callers share
 *     (CRC-16/CCITT, CRC-32, a seeded PRNG, XOR/concat, size formatting).
 *
 * PolyForm Noncommercial 1.0.0. (c) 2026 Dr Sohil Momin.
 */
(function (root) {
  "use strict";
  var Frame = { version: "2.0.0" };

  /* ---------- CRC-16/CCITT-FALSE ---------- */
  Frame.crc16 = function (bytes) {
    var crc = 0xffff;
    for (var i = 0; i < bytes.length; i++) {
      crc ^= bytes[i] << 8;
      for (var j = 0; j < 8; j++) {
        crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
      }
    }
    return crc & 0xffff;
  };

  /* ---------- CRC-32 (IEEE 802.3, reflected) ---------- */
  Frame.crc32 = function (bytes) {
    var crc = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) {
      crc ^= bytes[i];
      for (var b = 0; b < 8; b++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return (crc ^ 0xffffffff) >>> 0;
  };

  /* ---------- Mulberry32: small, fast, deterministic seeded PRNG ---------- */
  Frame.createPRNG = function (seed) {
    var s = seed >>> 0;
    return function next() {
      s = (s + 0x6d2b79f5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  /* ---------- 16 random bytes, used as a per-transfer id ---------- */
  Frame.generateUUID = function () {
    var out = new Uint8Array(16);
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
      crypto.getRandomValues(out);
    } else {
      for (var i = 0; i < out.length; i++) out[i] = (Math.random() * 256) & 0xff;
    }
    return out;
  };

  /* ---------- In-place XOR of `source` into `target` (target wins on length) ---------- */
  Frame.xorInto = function (target, source) {
    var n = Math.min(target.length, source.length);
    for (var i = 0; i < n; i++) target[i] ^= source[i];
    return target;
  };

  /* ---------- Concatenate byte arrays ---------- */
  Frame.concatBytes = function (chunks) {
    var total = 0, i;
    for (i = 0; i < chunks.length; i++) total += chunks[i].length;
    var out = new Uint8Array(total), p = 0;
    for (i = 0; i < chunks.length; i++) { out.set(chunks[i], p); p += chunks[i].length; }
    return out;
  };

  /* ---------- Human-readable byte size ---------- */
  Frame.formatSize = function (bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(2) + " MB";
  };

  /* ---------- Best-effort MIME type from a filename extension ---------- */
  Frame.guessType = function (name) {
    var ext = ((name || "").split(".").pop() || "").toLowerCase();
    var map = {
      txt: "text/plain", md: "text/markdown", json: "application/json",
      csv: "text/csv", html: "text/html", css: "text/css", js: "text/javascript",
      png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
      webp: "image/webp", svg: "image/svg+xml", pdf: "application/pdf",
      zip: "application/zip", mp3: "audio/mpeg", mp4: "video/mp4", wav: "audio/wav"
    };
    return map[ext] || "application/octet-stream";
  };

  /* =====================================================================
   * The frame.
   *
   *   0     magic        u8    which physical layer / transport carried it
   *   1     version      u8
   *   2-3   transferId   u16   identifies the transfer (restart on change)
   *   4-5   k            u16   number of source blocks
   *   6-7   blockSize    u16   bytes per symbol
   *   8-11  totalLength  u32   payload length (compressed container)
   *   12-15 payloadCRC   u32   CRC-32 of the whole payload
   *   16-19 symbolId     u32   fountain symbol id (0,1,2,... forever)
   *   20-21 headerCRC    u16   CRC-16 of bytes 0..19
   *   then blockSize bytes of fountain symbol data
   * ===================================================================== */
  Frame.VERSION = 1;
  Frame.HEADER_SIZE = 22;
  Frame.DEFAULT_MAGIC = 0xb7;

  // A frame is untrusted input: bound what a header may claim, so a corrupt or
  // crafted frame cannot make the receiver allocate a huge decoder.
  Frame.MAX_CONTAINER = 64 * 1024 * 1024;

  /** Total frame bytes (header + symbol) for a given block size. */
  Frame.frameBytes = function (blockSize) { return Frame.HEADER_SIZE + blockSize; };

  /** Number of source blocks a payload needs at this block size. */
  Frame.blockCount = function (length, blockSize) {
    return Math.max(1, Math.ceil(length / blockSize));
  };

  /** Pack one fountain symbol into a frame, header CRC included. */
  Frame.pack = function (o) {
    var magic = o.magic == null ? Frame.DEFAULT_MAGIC : o.magic;
    var payloadCRC = o.payloadCRC != null ? o.payloadCRC
      : (o.checksum != null ? o.checksum : 0);
    var data = o.data || new Uint8Array(0);
    var out = new Uint8Array(Frame.HEADER_SIZE + data.length);
    var view = new DataView(out.buffer);
    out[0] = magic;
    out[1] = Frame.VERSION;
    view.setUint16(2, o.transferId & 0xffff, false);
    view.setUint16(4, o.k, false);
    view.setUint16(6, o.blockSize, false);
    view.setUint32(8, o.totalLength >>> 0, false);
    view.setUint32(12, payloadCRC >>> 0, false);
    view.setUint32(16, o.symbolId >>> 0, false);
    view.setUint16(20, Frame.crc16(out.subarray(0, 20)), false);
    out.set(data, Frame.HEADER_SIZE);
    return out;
  };

  /**
   * Parse a decoded frame. Validates strictly and throws on anything malformed.
   *
   * @param {Uint8Array} bytes
   * @param {object} [opts]
   * @param {Set|number[]} [opts.magics]  accepted magic byte(s); omit to accept any
   * @param {string} [opts.label]         name used in the "not a … frame" error
   */
  Frame.parse = function (bytes, opts) {
    opts = opts || {};
    if (bytes.length < Frame.HEADER_SIZE) throw new Error("frame truncated");

    if (opts.magics != null) {
      var ok = opts.magics instanceof Set
        ? opts.magics.has(bytes[0])
        : Array.prototype.indexOf.call(opts.magics, bytes[0]) !== -1;
      if (!ok) throw new Error("not a " + (opts.label || "frame-kit") + " frame");
    }
    if (bytes[1] !== Frame.VERSION) {
      throw new Error("unsupported frame version " + bytes[1]);
    }

    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (Frame.crc16(bytes.subarray(0, 20)) !== view.getUint16(20, false)) {
      throw new Error("frame header failed its checksum");
    }

    var k = view.getUint16(4, false);
    var blockSize = view.getUint16(6, false);
    if (k === 0 || blockSize === 0) throw new Error("frame has an empty grid");

    // The payload must actually carry `blockSize` bytes — otherwise a short frame
    // could claim a huge block and blow up the decoder's allocation.
    if (bytes.length < Frame.HEADER_SIZE + blockSize) throw new Error("frame payload truncated");

    var totalLength = view.getUint32(8, false);
    if (totalLength > k * blockSize) throw new Error("frame sizes are inconsistent");
    if (totalLength > Frame.MAX_CONTAINER) throw new Error("frame declares an oversized transfer");

    var symbolId = view.getUint32(16, false);
    if (symbolId >= k * 64 + 1024) {
      // Guard against a header that decoded to nonsense despite the CRC.
      throw new Error("symbol id out of range");
    }

    return {
      magic: bytes[0],
      transferId: view.getUint16(2, false),
      k: k,
      blockSize: blockSize,
      totalLength: totalLength,
      payloadCRC: view.getUint32(12, false),
      symbolId: symbolId,
      data: bytes.slice(Frame.HEADER_SIZE, Frame.HEADER_SIZE + blockSize)
    };
  };

  /* =====================================================================
   * The rateless collector.
   *
   * It sits over a fountain decoder (the codec lives in `optical-kit`). Pass the
   * decoder factory as the one argument:
   *
   *   new Frame.FountainCollector(LTDecoder)
   *
   * The decoder must be `new Decoder(k, blockSize, totalLength)` and expose
   * `{ k, blockSize, length, complete, progress, addSymbol(id, data), payload() }`.
   * Omit the argument to use `optical-kit`'s decoder if it is loaded.
   * ===================================================================== */
  Frame.defaultDecoder = function (k, blockSize, transferId) {
    return Frame.Decoder(k, blockSize, transferId);
  };

  Frame.FountainCollector = class FountainCollector {
    constructor(Decoder) {
      this.Decoder = Decoder || Frame.defaultDecoder;
      if (typeof this.Decoder !== "function") {
        throw new Error("FountainCollector needs a decoder factory");
      }
      this.reset();
    }

    reset() {
      this.magic = null;
      this.transferId = null;
      this.decoder = null;
      this.checksum = 0;
      this.symbols = 0;
    }

    get count() { return this.decoder ? this.decoder.k : 0; }
    get received() {
      if (!this.decoder) return 0;
      return this.decoder.resolved != null ? this.decoder.resolved : 0;
    }
    get complete() { return this.decoder ? !!this.decoder.complete : false; }
    get progress() { return this.decoder ? this.decoder.progress : 0; }

    /** Absorb one decoded frame. */
    add(frame) {
      var magic = frame.magic == null ? null : frame.magic;
      if (
        !this.decoder ||
        this.magic !== magic ||
        this.transferId !== frame.transferId ||
        this.decoder.k !== frame.k ||
        this.decoder.blockSize !== frame.blockSize ||
        this.decoder.length !== frame.totalLength
      ) {
        this.magic = magic;
        this.transferId = frame.transferId;
        this.decoder = new this.Decoder(frame.k, frame.blockSize, frame.transferId);
        if ("length" in this.decoder) this.decoder.length = frame.totalLength;
        this.checksum = frame.payloadCRC;
        this.symbols = 0;
        this.decoder.addSymbol(frame.symbolId, frame.data);
        this.symbols++;
        return { fresh: true, restarted: true };
      }
      var fresh = this.decoder.addSymbol(frame.symbolId, frame.data);
      if (fresh) this.symbols++;
      return { fresh: fresh, restarted: false };
    }

    /** Rebuild the payload and verify its checksum. */
    assemble() {
      if (!this.complete) throw new Error("transfer incomplete");
      var out = this.decoder.payload();
      if (Frame.crc32(out) !== this.checksum) {
        throw new Error("checksum mismatch — rescan the code");
      }
      return out;
    }
  };


  /* =====================================================================
   * The fountain, which used to live in a second repository.
   *
   * `optical-kit` carried the encoder and a decoder of its own, with a second
   * 17-byte frame header beside this one. Both were used by the same three apps,
   * and both described "self-describing frames" — two definitions of the same
   * thing, drifting apart. They are one file now: this header, one CRC, one
   * decoder, and the encoder that was missing from here.
   * ===================================================================== */

  /** The indices XORed into symbol `seq`: the systematic prefix, then LT degrees. */
  Frame.symbolIndices = function (transferId, seq, k) {
    if (seq < k) return [seq];
    var rand = Frame.createPRNG(((transferId * 2654435761) ^ (seq * 40503)) >>> 0);
    var d = Frame.sampleDegree(rand, Frame.solitonCDF(k));
    var set = [], guard = 0;
    while (set.length < d && guard < 10000) {
      var idx = Math.floor(rand() * k);
      if (set.indexOf(idx) === -1) set.push(idx);
      guard++;
    }
    return set.length ? set : [0];
  };

  var _cdfCache = {};

  /** The robust-soliton degree distribution. */
  Frame.solitonCDF = function (k) {
    if (_cdfCache[k]) return _cdfCache[k];
    var c = 0.1, delta = 0.05;
    var R = c * Math.log(k / delta) * Math.sqrt(k);
    if (R < 0.01) R = 0.01;
    var kR = Math.floor(k / R);
    if (kR < 1) kR = 1;
    if (kR > k) kR = k;
    var rho = new Array(k + 1), tau = new Array(k + 1), Z = 0, i;
    for (i = 1; i <= k; i++) { rho[i] = (i === 1) ? 1 / k : 1 / (i * (i - 1)); tau[i] = 0; }
    for (i = 1; i < kR; i++) tau[i] = R / (i * k);
    tau[kR] += (R * Math.log(R / delta)) / k;
    var cdf = new Array(k + 1), acc = 0;
    for (i = 1; i <= k; i++) Z += rho[i] + tau[i];
    for (i = 1; i <= k; i++) { acc += (rho[i] + tau[i]) / Z; cdf[i] = acc; }
    cdf[k] = 1;
    _cdfCache[k] = cdf;
    return cdf;
  };

  Frame.sampleDegree = function (rand, cdf) {
    var r = rand(), lo = 1, hi = cdf.length - 1;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (cdf[mid] < r) lo = mid + 1; else hi = mid;
    }
    return lo;
  };

  /** Split a payload into blocks and return the encoder state. */
  Frame.Fountain = {
    encode: function (data, opts) {
      opts = opts || {};
      var blockSize = opts.blockSize || 1400;
      var blocks = [], n = data.length, i;
      for (i = 0; i < n; i += blockSize) {
        var b = new Uint8Array(blockSize);
        b.set(data.subarray(i, Math.min(i + blockSize, n)));
        blocks.push(b);
      }
      if (!blocks.length) blocks.push(new Uint8Array(blockSize));
      return {
        k: blocks.length,
        blockSize: blockSize,
        blocks: blocks,
        transferId: opts.transferId == null
          ? (1 + Math.floor(Math.random() * 65535))
          : (opts.transferId & 0xffff),
        totalLength: n,
        payloadCRC: Frame.crc32(data)
      };
    },

    /** The symbol bytes for one symbol id: the XOR of its source blocks. */
    symbol: function (e, seq) {
      var idx = Frame.symbolIndices(e.transferId, seq, e.k);
      var out = new Uint8Array(e.blockSize);
      for (var i = 0; i < idx.length; i++) {
        var b = e.blocks[idx[i]];
        for (var j = 0; j < out.length; j++) out[j] ^= b[j];
      }
      return out;
    }
  };

  /**
   * The peeling decoder.
   *
   * Contract, because `FountainCollector` builds one: `new Frame.Decoder(k, blockSize,
   * transferId)`, then `addSymbol(id, data)`, and read `k`, `blockSize`, `length`,
   * `complete`, `progress`, `resolved`, `payload()`.
   */
  Frame.Decoder = function (k, blockSize, transferId) {
    var solved = new Array(k), pending = [], seen = {};
    for (var s = 0; s < k; s++) solved[s] = null;

    function peel() {
      var progress = true;
      while (progress) {
        progress = false;
        for (var i = pending.length - 1; i >= 0; i--) {
          var p = pending[i], unknown = [], j;
          for (j = 0; j < p.indices.length; j++) {
            if (!solved[p.indices[j]]) unknown.push(p.indices[j]);
          }
          if (unknown.length === 0) { pending.splice(i, 1); continue; }
          if (unknown.length === 1) {
            var idx = unknown[0];
            solved[idx] = p.data.slice();
            pending.splice(i, 1);
            for (var q = 0; q < pending.length; q++) {
              var pos = pending[q].indices.indexOf(idx);
              if (pos !== -1) {
                var d = pending[q].data;
                for (var m = 0; m < d.length; m++) d[m] ^= solved[idx][m];
                pending[q].indices.splice(pos, 1);
              }
            }
            progress = true;
          }
        }
      }
    }

    function resolved() {
      var c = 0;
      for (var i = 0; i < k; i++) if (solved[i]) c++;
      return c;
    }

    return {
      k: k,
      blockSize: blockSize,
      transferId: transferId,
      length: 0,
      get complete() { return resolved() === k; },
      get progress() { return resolved() / k; },
      get resolved() { return resolved(); },

      addSymbol: function (id, data) {
        if (seen[id]) return false;
        seen[id] = 1;
        var idx = Frame.symbolIndices(transferId, id, k), out = data.slice(), i;
        for (i = 0; i < idx.length; i++) {
          if (solved[idx[i]]) for (var j = 0; j < out.length; j++) out[j] ^= solved[idx[i]][j];
        }
        var unknown = [];
        for (i = 0; i < idx.length; i++) if (!solved[idx[i]]) unknown.push(idx[i]);
        if (!unknown.length) return false;
        pending.push({ indices: unknown, data: out });
        peel();
        return true;
      },

      payload: function () {
        if (resolved() !== k) throw new Error("transfer incomplete");
        var all = new Uint8Array(k * blockSize);
        for (var i = 0; i < k; i++) all.set(solved[i], i * blockSize);
        return this.length ? all.subarray(0, this.length) : all;
      }
    };
  };

  /** Send a payload as frames. `next()` returns frame bytes. */
  Frame.Sender = function (data, opts) {
    var e = Frame.Fountain.encode(data, opts || {});
    var seq = 0;
    return {
      k: e.k,
      blockSize: e.blockSize,
      transferId: e.transferId,
      totalLength: e.totalLength,
      payloadCRC: e.payloadCRC,
      next: function () {
        var symbol = Frame.Fountain.symbol(e, seq);
        var bytes = Frame.pack({
          magic: (opts && opts.magic),
          transferId: e.transferId,
          k: e.k,
          blockSize: e.blockSize,
          totalLength: e.totalLength,
          payloadCRC: e.payloadCRC,
          symbolId: seq,
          data: symbol
        });
        seq++;
        return bytes;
      }
    };
  };

  /** Collect frames back into a payload, with the checksum checked. */
  Frame.Receiver = function (opts) {
    var c = new Frame.FountainCollector();
    return {
      add: function (bytes) {
        var f = Frame.parse(bytes, opts || {});
        return c.add(f);
      },
      get complete() { return c.complete; },
      get progress() { return c.progress; },
      get received() { return c.received; },
      payload: function () { return c.assemble(); }
    };
  };

  root.Frame = Frame;
  if (typeof module !== "undefined" && module.exports) module.exports = Frame;
})(typeof globalThis !== "undefined" ? globalThis : this);
