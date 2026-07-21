# Third-party notices

## playwright-rs 0.14.1

GamerCatch uses and redistributes a minimally modified copy of
[`playwright-rs`](https://github.com/padamson/playwright-rust), authored by
Paul Adamson and contributors, under the Apache License 2.0.

Local modifications are limited to:

- preferring an explicitly configured driver over a per-user cached driver;
- verifying the pinned playwright-core SHA-512 and Node.js SHA-256 before extraction;
- tests for the resolver order and checksum coverage.

The license text is preserved at `vendor/playwright-rs/LICENSE-APACHE`.

## Playwright driver and Node.js

The packaged `playwright-driver` directory preserves its upstream `LICENSE`,
`NOTICE`, `ThirdPartyNotices.txt`, and Node.js `LICENSE` files. Those notices
travel inside every platform ZIP.
