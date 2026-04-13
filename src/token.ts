// Token resolution removed — ephemeral signing needs no secrets.
// The sign action now uses `auths artifact sign --ci --commit <sha>`.
// No AUTHS_CI_TOKEN, no passphrase, no keychain, no identity repo.

export function cleanupPaths(paths: string[]): void {
  // No-op: ephemeral signing has no temp files to clean up
}
