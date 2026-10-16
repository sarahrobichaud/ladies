# Ladies ♕

[![CI Rust](https://github.com/sarahrobichaud/ladies/actions/workflows/ci-rust.yml/badge.svg)](https://github.com/sarahrobichaud/ladies/actions/workflows/ci-rust.yml)
[![CI TS](https://github.com/sarahrobichaud/ladies/actions/workflows/ci-ts.yml/badge.svg)](https://github.com/sarahrobichaud/ladies/actions/workflows/ci-ts.yml)

---

My second iteration of a poker game, rebuilt to put everything I've learned in practice.


## About 

This project is in development and is not playable yet.

**Next milestone:** Interactable player seat in the web client

## Development

**NixOS / Nix:**

```sh
nix develop
```

**Standard:** install Rust with the following components and targets, Node 24, and the latest pnpm:

- Rust components: `rust-src`, `rust-analyzer`, `clippy`, `rustfmt`
- Rust target: `wasm32-unknown-unknown`
- Node 24
- pnpm (latest)
- wasm-pack
- binaryen (provides `wasm-opt`)

Then, from the repo root:

```sh
pnpm install
pnpm web:wasm   # build wasm bindings into web/pkg
pnpm web:dev    # start the web dev server
```

Useful checks:

```sh
pnpm lint:fix
pnpm rust:fmt
pnpm rust:lint   # clippy with CI flags (RUSTFLAGS=-D warnings, --locked, --all-features)
pnpm rust:test
```
