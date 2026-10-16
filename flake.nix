{
  description = "Dev environment for ladies";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    rust-overlay = {
      url = "github:oxalica/rust-overlay";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, rust-overlay }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in
    {
      devShells = forAllSystems (system:
        let
          pkgs = import nixpkgs {
            inherit system;
            overlays = [ rust-overlay.overlays.default ];
          };

          # One toolchain: host + wasm32 std + matching dev tools
          rust = pkgs.rust-bin.stable.latest.default.override {
            extensions = [ "rust-src" "rust-analyzer" "clippy" "rustfmt" ];
            targets = [ "wasm32-unknown-unknown" ];
          };
        in
        {
          default = pkgs.mkShell {
            packages = [
              rust
              pkgs.gcc

              # node tooling
              pkgs.nodejs
              pkgs.pnpm

              # wasm tooling
              pkgs.wasm-pack
              pkgs.wasm-bindgen-cli
              pkgs.binaryen   # provides wasm-opt, used by wasm-pack in release builds
            ];

            RUST_SRC_PATH = "${rust}/lib/rustlib/src/rust/library";
          };
        });
    };
}
