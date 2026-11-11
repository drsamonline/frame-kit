# frame-kit — API reference

**Version 1.0.0.** **The shared transfer-frame core for drsamonline apps.** One file, no build step, no dependencies.

Generated from the source in this repository: every name, argument and
note below is read out of the kit file, so it cannot describe a function
that is not there.

```js
<script src="frame-kit.js"></script>
Kit.crc16(...)
// or: const Kit = require('./frame-kit.js')
```

## The surface (13 entries)

| Name | Arguments | What it does |
|---|---|---|
| `Kit.crc16` | `(bytes)` | — |
| `Kit.crc32` | `(bytes)` | — |
| `Kit.createPRNG` | `(seed)` | — |
| `Kit.generateUUID` | `()` | — |
| `Kit.xorInto` | `(target, source)` | — |
| `Kit.concatBytes` | `(chunks)` | — |
| `Kit.formatSize` | `(bytes)` | — |
| `Kit.guessType` | `(name)` | — |
| `Kit.frameBytes` | `(blockSize)` | Total frame bytes (header + symbol) for a given block size. |
| `Kit.blockCount` | `(length, blockSize)` | Number of source blocks a payload needs at this block size. |
| `Kit.pack` | `(o)` | Pack one fountain symbol into a frame, header CRC included. |
| `Kit.parse` | `(bytes, opts)` | Parse a decoded frame. Validates strictly and throws on anything malformed. @param {Uint8Array} bytes @param {object} [opts] @param {Set|number[]} [opts.magics] accepted magic byte(s); omit to accept  |
| `Kit.defaultDecoder` | `(k, blockSize, length)` | The rateless collector. It sits over a fountain decoder (the codec lives in `optical-kit`). Pass the decoder factory as the one argument: new Frame.FountainCollector(LTDecoder) The decoder must be `ne |

## Notes

- Zero dependencies, one file, no build step: it works from `file://`, from a
  `<script>` tag and from Node.
- The version above is the `VERSION` file in this repository; a pinned copy is
  what an app vendors.
