/**
 * Ensure auths CLI is available, downloading if necessary.
 * @param version - Specific version to use (e.g., "0.5.0"), or empty for latest
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
