# frame-kit

[![live](https://img.shields.io/badge/live-online-22c55e)](https://drsamonline.github.io/frame-kit/)
[![License: PolyForm Noncommercial 1.0.0](https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-blue)](LICENSE)


**The shared transfer-frame core for drsamonline apps.** One file, no build step,
no dependencies.

`optical-kit` moves bytes; `frame-kit` *wraps* them. It is the layer the
optical-transfer apps (`helioprism`, `blinkcode-ai`, `BLINKTRANSFER`) were each
re-implementing: a self-describing frame, the rateless collector that locks onto a
stream, and the byte/checksum helpers underneath.

## What it gives you

- **A 22-byte self-describing header** — magic, version, transferId, k,
  blockSize, totalLength, a payload CRC-32, the symbol id, and a header CRC-16.
  A receiver can lock onto *any* frame, mid-stream, with no separate header code.
- **Strict validation of untrusted input** — a decoded frame is bytes from a
  camera; a corrupt or crafted header is dropped, not allowed to allocate.
- **A rateless `FountainCollector`** — absorbs symbols in any order, tolerates
  duplicates, restarts when the transfer id changes, and verifies the payload
  checksum when it assembles.
- **Byte/checksum utilities** — CRC-16/CCITT, CRC-32, a seeded PRNG, XOR/concat
  helpers and size formatting.

## Use it

Drop `frame-kit.js` next to your code and load it, then use the global `Frame`:

```html
<script src="frame-kit.js"></script>
<script>
  const frame = Frame.pack({
    magic: 0xb7, transferId: 42, k, blockSize,
    totalLength: payload.length, payloadCRC: Frame.crc32(payload),
    symbolId, data: symbol,
  });
  const parsed = Frame.parse(frame, { magics: [0xb7], label: 'MyApp' });
</script>
```

The collector sits over a fountain decoder (the codec lives in `optical-kit`).
Pass the decoder factory, or omit it to use `optical-kit`'s decoder if it is
loaded:

```js
const rx = new Frame.FountainCollector(LTDecoder);   // your decoder
rx.add(Frame.parse(bytes, { magics: [0xb7] }));
rx.progress;                 // 0..1
rx.assemble();               // Uint8Array, checksum verified — or throws
```

## API

| | |
|---|---|
| `Frame.pack(opts)` | Build a frame from `{ magic?, transferId, k, blockSize, totalLength, payloadCRC\|checksum, symbolId, data }`. |
| `Frame.parse(bytes, opts?)` | Parse and validate; `opts` = `{ magics?, label? }`. Throws on anything malformed. |
| `Frame.FountainCollector(Decoder)` | The rateless collector. `.add(frame)`, `.assemble()`, `.complete`, `.progress`, `.received`, `.count`, `.symbols`, `.transferId`, `.magic`, `.reset()`. |
| `Frame.crc16`, `Frame.crc32` | CRC-16/CCITT-FALSE and CRC-32 (IEEE 802.3). |
| `Frame.createPRNG(seed)` | Mulberry32 seeded PRNG. |
| `Frame.xorInto`, `Frame.concatBytes`, `Frame.formatSize`, `Frame.generateUUID`, `Frame.guessType` | The small helpers the apps share. |
| `Frame.HEADER_SIZE`, `Frame.VERSION`, `Frame.MAX_CONTAINER`, `Frame.DEFAULT_MAGIC`, `Frame.frameBytes`, `Frame.blockCount` | Frame geometry. |

## Verified

`test-node.js` proves the frame, its validation and the collector:

```
node test-node.js
...
19 passed, 0 failed
```

## Support

<img src="docs/assets/support-portrait.jpg" width="72" height="72" alt="Dr. Sohil Momin" align="left" style="border-radius:50%;margin-right:1rem">

Free, offline, accountless — and staying that way. If it earned its keep:

| | |
|---|---|
| UPI (India) | `drsohilboi@ybl` — payee Dr. Sohil Momin, open amount, or scan [the QR](docs/assets/upi-qr.svg) |
| GitHub Sponsors | [github.com/sponsors/drsamonline](https://github.com/sponsors/drsamonline) |
| Ko-fi | [ko-fi.com/matneo](https://ko-fi.com/matneo) |
| PayPal | [paypal.me/drsohilmomin](https://paypal.me/drsohilmomin?locale.x=en_GB&country.x=IN) |
| My books | [Amazon author store](https://www.amazon.com/stores/author/B08ZT331LY/allbooks?ccs_id=aed72b9f-71d9-41dc-adee-e9368a317acc) |
| More apps | [drsamonline.github.io](https://drsamonline.github.io/) |
| Email | [sohilmomin2000@gmail.com](mailto:sohilmomin2000@gmail.com) |

Nothing is gated behind it: no accounts, no tracking, no network requests.

## Licence

PolyForm Noncommercial 1.0.0. (c) 2026 Dr Sohil Momin.

Part of the Forge system. Kits are open; the orchestrator is licensed.
