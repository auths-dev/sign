# auths-dev/sign

[![Verified with Auths](https://img.shields.io/badge/Verified%20with-Auths-4B9CD3?logo=github&logoColor=white)](https://github.com/auths-dev/verify)

Sign build artifacts and commits in CI using ephemeral keys. **No secrets needed.**

## Quick Start

```yaml
- uses: auths-dev/sign@v1
  with:
    files: |
      dist/*.tar.gz
      dist/*.zip
```

No tokens. No secrets. The action generates a throwaway key per run, signs your artifacts, and discards the key. Trust is anchored to the commit, not to a CI credential.

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
| `auths-version` | No | latest | Auths CLI version to use |

At least one of `files` or `commits` must be provided.

## Outputs

| Output | Description |
|--------|-------------|
| `signed-files` | JSON array of signed file paths |
| `attestation-files` | JSON array of `.auths.json` paths |
| `signed-commits` | JSON array of signed commit SHAs |
