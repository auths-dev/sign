import * as cache from '@actions/cache';
import * as core from '@actions/core';
import * as io from '@actions/io';
import * as tc from '@actions/tool-cache';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Repository that hosts the public auths CLI releases
const CLI_RELEASE_REPO = 'auths-dev/auths';

/**
 * Ensure auths CLI is available, downloading if necessary.
 * @param version - Specific version to use (e.g., "0.5.0"), or empty for latest
 */
export async function ensureAuthsInstalled(version: string): Promise<string | null> {
  const binaryName = getBinaryName();

  // Check if auths is in PATH (cross-platform)
  try {
    const authsInPath = await io.which('auths', false);
    if (authsInPath) {
      core.info(`Using auths from PATH: ${authsInPath}`);
      return authsInPath;
    }
  } catch {
    // Not found in PATH
  }

  // Determine the version for cache lookup
  const cacheVersion = version || 'latest';

  // Check tool cache
  const cachedPath = tc.find('auths', cacheVersion);
  if (cachedPath) {
    const binaryPath = path.join(cachedPath, binaryName);
    if (fs.existsSync(binaryPath)) {
      core.info(`Using cached auths: ${binaryPath}`);
      return binaryPath;
    }
  }

  // Determine download URL early (needed for cache key)
  const downloadUrl = getAuthsDownloadUrl(version);
  if (!downloadUrl) {
    core.warning(`Cannot determine auths download URL for this platform (${os.platform()}/${os.arch()})`);
    return null;
  }

  // Try cross-run cache (only for pinned versions — "latest" can change between runs)
  const useCrossRunCache = version.length > 0;
  const urlHash = crypto.createHash('sha256').update(downloadUrl).digest('hex').slice(0, 16);
  const cacheKey = `auths-bin-${os.platform()}-${os.arch()}-${urlHash}`;
  const cachePaths = [path.join(os.tmpdir(), 'auths-cache')];

  if (useCrossRunCache) {
    try {
      const hit = await cache.restoreCache(cachePaths, cacheKey);
      if (hit) {
        core.info(`Restored auths from cache (key: ${cacheKey})`);
        const restoredBinary = path.join(cachePaths[0], binaryName);
        if (fs.existsSync(restoredBinary)) {
          const cachedDir = await tc.cacheDir(cachePaths[0], 'auths', cacheVersion);
          return path.join(cachedDir, binaryName);
        }
      }
    } catch (e) {
      core.debug(`Cache restore failed (non-fatal): ${e}`);
    }
  }

  // Try to download from releases
  core.info('auths CLI not found, attempting to download...');

  try {
    core.info(`Downloading auths from: ${downloadUrl}`);
    const downloadPath = await tc.downloadTool(downloadUrl);

    // Verify SHA256 checksum
    await verifyChecksum(downloadUrl, downloadPath);

    // Extract if archive
    let extractedPath: string;
    if (downloadUrl.endsWith('.tar.gz')) {
      extractedPath = await tc.extractTar(downloadPath);
    } else if (downloadUrl.endsWith('.zip')) {
      extractedPath = await tc.extractZip(downloadPath);
    } else {
      extractedPath = downloadPath;
    }

    // Find the binary
    const binaryPath = path.join(extractedPath, binaryName);
    if (fs.existsSync(binaryPath)) {
      // Make executable (no-op on Windows)
      if (os.platform() !== 'win32') {
        fs.chmodSync(binaryPath, '755');
      }

      // Save to cross-run cache (best-effort, don't fail the action)
      if (useCrossRunCache) {
        try {
          fs.cpSync(extractedPath, cachePaths[0], { recursive: true });
          await cache.saveCache(cachePaths, cacheKey);
          core.info(`Saved auths to cache (key: ${cacheKey})`);
        } catch (e) {
          core.debug(`Cache save failed (non-fatal): ${e}`);
        }
      }

      // Cache it with the actual version (tool-cache for same-run reuse)
      const cachedDir = await tc.cacheDir(extractedPath, 'auths', cacheVersion);
      core.info(`Cached auths at: ${cachedDir}`);

      return path.join(cachedDir, binaryName);
    }

    core.warning(`Binary not found at expected path: ${binaryPath}`);
  } catch (error) {
    core.warning(`Failed to download auths: ${error}`);
  }

  return null;
}

/**
 * Verify SHA256 checksum of a downloaded file against a .sha256 file from the release.
 */
export async function verifyChecksum(downloadUrl: string, filePath: string): Promise<void> {
  const checksumUrl = `${downloadUrl}.sha256`;

  try {
    const checksumPath = await tc.downloadTool(checksumUrl);
    const checksumContent = fs.readFileSync(checksumPath, 'utf8').trim();
    const expectedHash = checksumContent.split(/\s+/)[0].toLowerCase();

    const fileBuffer = fs.readFileSync(filePath);
    const actualHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    if (actualHash !== expectedHash) {
      throw new Error(
        `SHA256 checksum mismatch for downloaded binary!\n` +
        `Expected: ${expectedHash}\n` +
        `Got:      ${actualHash}\n` +
        `This could indicate a compromised release. Do NOT use this binary.`
      );
    }

    core.info(`SHA256 checksum verified: ${actualHash.substring(0, 16)}...`);
  } catch (error) {
    if (error instanceof Error && error.message.includes('checksum mismatch')) {
      throw error;
    }
    core.warning(
      'SHA256 checksum file not available for this release. ' +
      'Skipping verification. Consider upgrading to a release with checksums.'
    );
  }
}

/**
 * Get the platform-specific binary name
 */
export function getBinaryName(): string {
  return os.platform() === 'win32' ? 'auths.exe' : 'auths';
}

/**
 * Get download URL for auths binary.
 */
export function getAuthsDownloadUrl(version: string): string | null {
  const platform = os.platform();
  const arch = os.arch();

  const platformMap: Record<string, string> = {
    'linux': 'linux',
    'darwin': 'macos',
    'win32': 'windows'
  };

  const archMap: Record<string, string> = {
    'x64': 'x86_64',
    'arm64': 'aarch64'
  };

  const platformName = platformMap[platform];
  const archName = archMap[arch];

  if (!platformName || !archName) {
    return null;
  }

  const ext = platform === 'win32' ? '.zip' : '.tar.gz';
  const assetName = `auths-${platformName}-${archName}${ext}`;

  if (version) {
    return `https://github.com/${CLI_RELEASE_REPO}/releases/download/v${version}/${assetName}`;
  }

  return `https://github.com/${CLI_RELEASE_REPO}/releases/latest/download/${assetName}`;
}
