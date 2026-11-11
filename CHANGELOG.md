# Changelog

## 2.0.0 — 2026-11-12

**The fountain moved in.** `optical-kit` is folded into this kit, so one file carries both
halves of a transfer: the LT fountain code that moves bytes and the frame that wraps them.

- **Added** `Frame.Fountain` — the systematic LT encoder (`encode`, `symbol`) with the
  robust-soliton degree distribution.
- **Added** `Frame.Decoder` — the peeling decoder, seeded by the transfer id, implementing
  this kit's decoder contract (`addSymbol`, `payload`, `complete`, `progress`, `resolved`).
- **Added** `Frame.Sender` and `Frame.Receiver` — the two ends, in frame-kit's own format.
- **Fixed** `Frame.defaultDecoder` built its decoder with a hard-coded session of `1`, so a
  collector could only ever peel a stream whose sender happened to use that id. It is passed
  the frame's transfer id now, and `FountainCollector` passes it.
- **Removed** the second frame format: `optical-kit`'s 17-byte header, its duplicate CRC and
  its own decoder are gone. Anything that used `Optical.Frame` should use `Frame.pack`,
  `Frame.parse` and `Frame.Sender`/`Frame.Receiver`.
- **Unchanged** the 22-byte header, `Frame.pack`, `Frame.parse`, `Frame.crc16`, `Frame.crc32`
  and `Frame.FountainCollector`. A vendored copy of this kit keeps working.


## 1.0.0 — 2026-10-25

- **Licence: PolyForm Noncommercial 1.0.0.** Every repository now carries the canonical text
  from polyformproject.org with the Required Notice line, and the four places a repo states
  its licence agree: LICENSE, the SPDX headers, the README and package.json.
- **The public demo is the app.** A build now fails if `docs/play/index.html` is not the app,
  because a demo running older code is two code paths for one program.
