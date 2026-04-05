export interface ResolvedCredentials {
    passphrase: string;
    keychainPath: string;
    identityRepoPath: string;
    verifyBundlePath: string;
    tempPaths: string[];
}
/**
 * Resolve credentials from either a CiToken JSON or individual action inputs.
 * Prefers `token` when provided. Falls back to individual inputs.
 */
export declare function resolveCredentials(): Promise<ResolvedCredentials>;
export declare function cleanupPaths(paths: string[]): void;
