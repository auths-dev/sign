/**
 * Ensure auths CLI is available, downloading if necessary.
 * @param version - Released version to pin (e.g., "0.0.1-rc.12"). Required unless
 *                  `auths` is already on PATH — an empty version throws; `latest`
 *                  is never resolved (supply-chain hardening).
 */
export declare function ensureAuthsInstalled(version: string): Promise<string | null>;
/**
 * Verify SHA256 checksum of a downloaded file against a .sha256 file from the release.
 */
export declare function verifyChecksum(downloadUrl: string, filePath: string): Promise<void>;
/**
 * Get the platform-specific binary name
 */
export declare function getBinaryName(): string;
/**
 * Get download URL for auths binary.
 */
export declare function getAuthsDownloadUrl(version: string): string | null;
