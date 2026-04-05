# auths-dev/sign

Sign build artifacts in CI with [Auths](https://github.com/auths-dev/auths) identity keys. Produces `.auths.json` attestation files that anyone can verify.

## Quick start

```yaml
- uses: auths-dev/sign@v1
  with:
    token: ${{ secrets.AUTHS_CI_TOKEN }}
    files: 'dist/index.js'
    verify: true
```

This signs `dist/index.js`, creates `dist/index.js.auths.json`, and verifies the signature in one step.

## Setup

### 1. Install the Auths CLI

```bash
brew install auths          # macOS
# or download from https://github.com/auths-dev/auths/releases
```

### 2. Initialize your identity (if you haven't already)

```bash
auths init
```

### 3. Set up CI secrets

From the repo you want to sign artifacts in:

```bash
just ci-setup
# or: bash scripts/ci-setup.sh
```

This creates a limited-capability CI device key and sets the required GitHub secrets automatically.

### 4. Add the action to your release workflow

```yaml
name: Release

on:
  push:
    tags: ['v*.*.*']

permissions:
  contents: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Build
        run: npm run build  # or your build command

      - name: Sign artifacts
        uses: auths-dev/sign@v1
        with:
          token: ${{ secrets.AUTHS_CI_TOKEN }}
          files: 'dist/*.js'
          verify: true
          note: 'Release ${{ github.ref_name }}'

      - name: Create release
        uses: softprops/action-gh-release@v2
        with:
          files: |
            dist/*.auths.json
```

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `token` | No* | | `AUTHS_CI_TOKEN` JSON containing all credentials |
| `files` | **Yes** | | Glob patterns for files to sign (one per line) |
| `verify` | No | `false` | Verify each file immediately after signing |
| `device-key` | No | `ci-release-device` | Device key alias to sign with |
| `note` | No | | Note to include in the attestation |
| `auths-version` | No | latest | Pin a specific Auths CLI version |

*Either `token` or the individual credential inputs (`passphrase`, `keychain`, `identity-repo`) are required.

### Individual credential inputs (fallback)

If you're not using `AUTHS_CI_TOKEN`, provide these instead:

| Input | Description |
|-------|-------------|
| `passphrase` | Device key passphrase (`AUTHS_CI_PASSPHRASE` secret) |
| `keychain` | Base64-encoded encrypted keychain (`AUTHS_CI_KEYCHAIN` secret) |
| `identity-repo` | Base64-encoded tar.gz of identity repo (`AUTHS_CI_IDENTITY_BUNDLE` secret) |
| `verify-bundle` | Identity bundle JSON for verification (`AUTHS_CI_IDENTITY_BUNDLE_JSON` secret) |

```yaml
- uses: auths-dev/sign@v1
  with:
    passphrase: ${{ secrets.AUTHS_CI_PASSPHRASE }}
    keychain: ${{ secrets.AUTHS_CI_KEYCHAIN }}
    identity-repo: ${{ secrets.AUTHS_CI_IDENTITY_BUNDLE }}
    verify-bundle: ${{ secrets.AUTHS_CI_IDENTITY_BUNDLE_JSON }}
    files: 'dist/index.js'
    verify: true
```

## Outputs

| Output | Description |
|--------|-------------|
| `signed-files` | JSON array of signed file paths |
| `attestation-files` | JSON array of `.auths.json` attestation file paths |
| `verified` | `true`/`false` when `verify: true`, empty otherwise |

### Using outputs in subsequent steps

```yaml
- uses: auths-dev/sign@v1
  id: sign
  with:
    token: ${{ secrets.AUTHS_CI_TOKEN }}
    files: 'dist/**/*.tar.gz'

- name: Upload attestations
  uses: actions/upload-artifact@v4
  with:
    name: attestations
    path: ${{ fromJSON(steps.sign.outputs.attestation-files) }}
```

## Glob patterns

The `files` input supports glob patterns, one per line:

```yaml
files: |
  dist/*.tar.gz
  dist/*.zip
  build/output/**/*.whl
```

Patterns follow [@actions/glob](https://github.com/actions/toolkit/tree/master/packages/glob) syntax. Symlinks are not followed. Paths outside the workspace are rejected.

## Verification

When `verify: true`, the action runs `auths artifact verify` on each signed file immediately after signing. This proves the full round-trip works and catches signing misconfigurations before they reach consumers.

Consumers can verify your artifacts independently:

```bash
auths artifact verify dist/index.js --identity-bundle bundle.json
```

Or using the [auths-dev/auths-verify-github-action](https://github.com/auths-dev/auths-verify-github-action):

```yaml
- uses: auths-dev/auths-verify-github-action@v1
  with:
    identity-bundle-json: ${{ secrets.AUTHS_CI_IDENTITY_BUNDLE_JSON }}
    artifact-paths: 'dist/index.js'
```

## Security model

- The CI device key has **limited capabilities** (`sign_release` only) -- it cannot impersonate your root identity, link devices, or perform other privileged operations
- Credentials are extracted to temp files that are **always cleaned up**, even on failure
- The passphrase is **masked** from all GitHub Actions logs via `core.setSecret`
- Glob results are **contained to the workspace** -- paths outside `$GITHUB_WORKSPACE` are rejected
- You can **revoke CI access** at any time: `auths device revoke --device-did <DID> --key <ALIAS>`

## Revoking CI access

If the CI device key is compromised:

```bash
auths device revoke --device-did <DEVICE_DID> --key <KEY_ALIAS>
```

The device DID and key alias are printed by `just ci-setup` during initial setup. After revocation, existing attestations remain valid (they were legitimate when signed), but the device can no longer produce new ones.

## License

Apache-2.0
