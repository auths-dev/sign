# auths-dev/sign

[![Verified with Auths](https://img.shields.io/badge/Verified%20with-Auths-4B9CD3?logo=github&logoColor=white)](https://github.com/auths-dev/verify)

Sign build artifacts and commits in CI using ephemeral keys. **No secrets needed.**

## Quick Start

```yaml
name: Sign artifacts
on:
  push:
    branches: [main]

permissions:
  contents: write             # no id-token, no secrets — ephemeral signing needs neither

jobs:
  sign:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: auths-dev/sign@v1
        with:
          auths-version: "0.1.3"   # pin the CLI — the action never resolves `latest`
          files: |
            dist/*.tar.gz
            dist/*.zip
```

A copy-paste starter lives at [`examples/.github/workflows/auths.yml`](examples/.github/workflows/auths.yml).

No tokens. No secrets. The action generates a throwaway key per run, signs your artifacts, and discards the key. Trust is anchored to the commit, not to a CI credential.

> **Publish a trust root first.** The signature is only verifiable if your repo commits a `.auths/roots` pin (`auths init`). Without it, the action still signs but warns that the attestation is **unanchored** (`auths verify` → RootNotPinned). Set `fail-on-unanchored: true` to make that a hard error.

## How It Works

1. Installs the `auths` CLI
2. Runs `auths artifact sign --ci --commit $GITHUB_SHA` for each matched file
3. Produces `.auths.json` attestation files alongside your artifacts
4. Verifiers trace: artifact ← ephemeral key ← commit SHA ← maintainer signature

## Usage

### Sign release artifacts

```yaml
- name: Sign artifacts
  uses: auths-dev/sign@v1
  with:
    files: |
      dist/*.tar.gz
      dist/*.zip
    note: "Release ${{ github.ref_name }}"
```

### Sign commits

```yaml
- name: Sign commits
  uses: auths-dev/sign@v1
  with:
    commits: HEAD~1..HEAD
```

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `files` | No | | Glob patterns for files to sign, one per line |
| `commits` | No | | Git revision range to sign |
| `commit-sha` | No | `$GITHUB_SHA` | Commit SHA to anchor attestation to |
| `note` | No | | Note to include in the attestation |
| `auths-version` | Yes (unless on PATH) | | Auths CLI version to **pin** (e.g. `0.1.3`); the action never resolves `latest` and fails closed without a verifiable `.sha256` |
| `fail-on-unanchored` | No | `false` | Fail (instead of warn) when no `.auths/roots` trust root is present |

At least one of `files` or `commits` must be provided.

## Outputs

| Output | Description |
|--------|-------------|
| `signed-files` | JSON array of signed file paths |
| `attestation-files` | JSON array of `.auths.json` paths |
| `signed-commits` | JSON array of signed commit SHAs |

## License

Apache-2.0. See [LICENSE](LICENSE).
