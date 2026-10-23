/* Node test for frame-kit: the frame, its validation, and the rateless collector.
 *
 * The real fountain codec lives in `optical-kit`; here the collector is given a
 * small *systematic* reference decoder (symbol id i carries block i) so this file
 * tests frame-kit's own job — framing, locking, restart and checksum — without
 * depending on the codec. (Recovering from dropped symbols is the codec's job, so
 * a dropped symbol is simply reported as an incomplete transfer here.)
 *
 *   node test-node.js
 */
const path = require("path");
require(path.join(__dirname, "frame-kit.js"));
const Frame = global.Frame;

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log("PASS  " + label); }
  else { fail++; console.log("FAIL  " + label + (extra ? "  " + JSON.stringify(extra) : "")); }
}
function throws(fn, re, label) {
  try { fn(); fail++; console.log("FAIL  " + label + "  (did not throw)"); }
  catch (e) {
    if (re.test(e.message)) { pass++; console.log("PASS  " + label); }
    else { fail++; console.log("FAIL  " + label + "  threw: " + e.message); }
  }
}

const MAGIC = 0xb7;
const rand = (n) => { const a = new Uint8Array(n); for (let i = 0; i < n; i++) a[i] = (i * 2654435761) % 256; return a; };

/* ---- reference decoder: symbol id i carries source block i ---- */
function SystematicDecoder(k, blockSize, length) {
  this.k = k; this.blockSize = blockSize; this.length = length;
  this.blocks = new Array(k); this.resolved = 0;
}
SystematicDecoder.prototype.addSymbol = function (id, data) {
  if (id >= this.k || this.blocks[id]) return false;
  this.blocks[id] = data.slice(); this.resolved++; return true;
};
SystematicDecoder.prototype.payload = function () {
  const out = new Uint8Array(this.length);
  let off = 0;
  for (let i = 0; i < this.k; i++) {
    const b = this.blocks[i]; const n = Math.min(b.length, this.length - off);
    out.set(b.subarray(0, n), off); off += n;
  }
  return out;
};
Object.defineProperty(SystematicDecoder.prototype, "complete", { get() { return this.resolved >= this.k; } });
Object.defineProperty(SystematicDecoder.prototype, "progress", { get() { return this.resolved / this.k; } });

function split(payload, blockSize) {
  const k = Frame.blockCount(payload.length, blockSize);
  const blocks = [];
  for (let i = 0; i < k; i++) {
    const b = new Uint8Array(blockSize);
    b.set(payload.subarray(i * blockSize, Math.min((i + 1) * blockSize, payload.length)));
    blocks.push(b);
  }
  return blocks;
}

function sender(payload, blockSize, transferId) {
  const blocks = split(payload, blockSize);
  const k = blocks.length;
  const checksum = Frame.crc32(payload);
  return {
    k, blockSize, checksum,
    frame(id) {
      return Frame.pack({
        magic: MAGIC, transferId, k, blockSize, totalLength: payload.length,
        payloadCRC: checksum, symbolId: id, data: blocks[id % k],
      });
    },
  };
}

function collect(payload, blockSize, { loss = 0, dup = false, order = null } = {}) {
  const s = sender(payload, blockSize, 0x0042);
  const c = new Frame.FountainCollector(SystematicDecoder);
  const ids = order || Array.from({ length: s.k * 2 }, (_, i) => i);
  let sent = 0, accepted = 0;
  for (const id of ids) {
    if (c.complete) break;
    sent++;
    if (loss && ((id * 2654435761) % 100) / 100 < loss) continue; // deterministic drop
    const f = Frame.parse(s.frame(id), { magics: [MAGIC], label: "test" });
    if (c.add(f).fresh) accepted++;
    if (dup && c.add(f).fresh) accepted++;
  }
  return { collector: c, sent, accepted, k: s.k };
}

/* ---- frame round-trip and validation ---- */
(function () {
  const data = rand(64);
  const frame = Frame.pack({ magic: MAGIC, transferId: 0x1234, k: 40, blockSize: 64, totalLength: 2500, payloadCRC: 0xdeadbeef, symbolId: 7, data });
  ok(frame.length === Frame.HEADER_SIZE + 64, "pack produces a header + symbol");
  const p = Frame.parse(frame, { magics: [MAGIC], label: "test" });
  ok(p.transferId === 0x1234 && p.k === 40 && p.symbolId === 7 && p.payloadCRC === 0xdeadbeef, "parse reads the header back");
  ok(p.data.length === 64 && p.data.every((v, i) => v === data[i]), "parse returns the symbol bytes");

  const bad = frame.slice(); bad[6] ^= 0xff;
  throws(() => Frame.parse(bad, { magics: [MAGIC], label: "test" }), /checksum/, "a corrupted header fails its CRC-16");

  throws(() => Frame.parse(new Uint8Array(Frame.HEADER_SIZE), { magics: [MAGIC], label: "test" }), /not a test frame/, "an unknown magic is rejected");
  throws(() => Frame.parse(Uint8Array.of(1, 2, 3), { magics: [MAGIC], label: "test" }), /truncated/, "a short buffer is rejected");

  const mk = (over) => Frame.pack({ magic: MAGIC, transferId: 1, k: 2, blockSize: 32, totalLength: 40, payloadCRC: 1, symbolId: 0, data: new Uint8Array(32), ...over });
  throws(() => Frame.parse(mk({ totalLength: 5000 }), { magics: [MAGIC], label: "test" }), /inconsistent/, "an impossible totalLength is rejected");
  throws(() => Frame.parse(mk().subarray(0, 30), { magics: [MAGIC], label: "test" }), /truncated/, "a truncated payload is rejected");
  throws(() => Frame.parse(mk({ k: 65535, blockSize: 65535, totalLength: 200 * 1024 * 1024, data: new Uint8Array(65535) }), { magics: [MAGIC], label: "test" }), /oversized/, "an oversized transfer is rejected");
  throws(() => Frame.parse(mk({ blockSize: 0, totalLength: 0, data: new Uint8Array(0) }), { magics: [MAGIC], label: "test" }), /empty grid/, "an empty grid is rejected");
  throws(() => Frame.parse(mk({ k: 2, blockSize: 16, totalLength: 20, symbolId: 0xffffff, data: new Uint8Array(16) }), { magics: [MAGIC], label: "test" }), /out of range/, "an out-of-range symbol id is rejected");
})();

/* ---- checksum utilities ---- */
ok(Frame.crc32(new TextEncoder().encode("123456789")) === 0xcbf43926, "crc32 matches the known check value");
ok(Frame.crc16(new TextEncoder().encode("123456789")) === 0x29b1, "crc16/CCITT matches the known check value");

/* ---- the collector: duplicates, out-of-order, restart, checksum ---- */
(function () {
  const payload = rand(50 * 1024);
  const k = Frame.blockCount(payload.length, 1400);
  // out-of-order (evens then odds) and every frame sent twice
  const order = [];
  for (let i = 0; i < k; i += 2) order.push(i);
  for (let i = 1; i < k; i += 2) order.push(i);
  const r = collect(payload, 1400, { dup: true, order });
  ok(r.collector.complete, "a duplicated, out-of-order stream reassembles");
  ok(Frame.crc32(r.collector.assemble()) === Frame.crc32(payload), "the reassembled payload checksums");

  // A purely systematic reference decoder cannot recover a dropped symbol, so
  // the collector must report incomplete rather than ever completing on a gap.
  const rl = collect(payload, 1400, { loss: 0.4 });
  ok(!rl.collector.complete, "a stream with dropped symbols is reported incomplete");
  throws(() => rl.collector.assemble(), /incomplete/, "assemble refuses an incomplete transfer");
  console.log("      (k=" + k + " blocks; duplicated run accepted " + r.accepted + ")");
})();

(function () {
  const s1 = sender(rand(4096), 512, 1);
  const s2 = sender(rand(4096), 512, 2);
  const c = new Frame.FountainCollector(SystematicDecoder);
  c.add(Frame.parse(s1.frame(0), { magics: [MAGIC], label: "test" }));
  const r = c.add(Frame.parse(s2.frame(0), { magics: [MAGIC], label: "test" }));
  ok(r.restarted === true && c.transferId === 2 && c.received === 1, "a new transfer id restarts the collector");
})();

(function () {
  const payload = rand(4096);
  const s = sender(payload, 512, 9);
  const c = new Frame.FountainCollector(SystematicDecoder);
  for (let id = 0; id < s.k; id++) c.add(Frame.parse(s.frame(id), { magics: [MAGIC], label: "test" }));
  c.decoder.blocks[0][0] ^= 0xff;
  throws(() => c.assemble(), /checksum/, "a corrupted payload is caught by the CRC-32");
})();

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
