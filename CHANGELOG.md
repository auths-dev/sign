# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2026-06-08

### Added

- `fail-on-unanchored` input: fail (instead of warn) when the repository has no
  `.auths/roots` trust root, so signing never silently produces an attestation that
  verifiers cannot anchor (`auths verify` → `RootNotPinned`).
- Pre-flight check that warns by default when signing would produce an unanchored
  attestation, pointing users to run `auths init` and commit `.auths/roots`.

### Changed

- **Supply-chain hardening (consumer-visible behavior change):** `auths-version` is now
  effectively required unless the `auths` CLI is already on `PATH`. The action no longer
  resolves `releases/latest`; you must pin a released version (e.g. `0.0.1-rc.12`).
- The downloaded CLI is now integrity-checked and **fails closed**: a release whose
  `.sha256` checksum cannot be fetched is rejected rather than run unverified.
- `dist/index.js` rebuilt so the shipped bundle matches `action.yml` (the previous bundle
  predated these features).

## [1.0.2] - 2026-04-15

### Added

- Initial public releases of the Sign action: sign build artifacts and commits in CI
  using ephemeral, per-run keys (no secrets). Inputs: `files`, `commits`, `commit-sha`,
  `note`, `auths-version`. Outputs: `signed-files`, `attestation-files`, `signed-commits`.

[Unreleased]: https://github.com/auths-dev/sign/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/auths-dev/sign/compare/v1.0.2...v1.1.0
[1.0.2]: https://github.com/auths-dev/sign/releases/tag/v1.0.2
