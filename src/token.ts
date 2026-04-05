import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface ResolvedCredentials {
  passphrase: string;
  keychainPath: string;
  identityRepoPath: string;
  verifyBundlePath: string;
  tempPaths: string[];
}

interface CiToken {
  version: number;
  passphrase: string;
  keychain: string;
  identity_repo: string;
  verify_bundle: Record<string, unknown>;
  created_at: string;
  max_valid_for_secs: number;
}

/**
 * Resolve credentials from either a CiToken JSON or individual action inputs.
 * Prefers `token` when provided. Falls back to individual inputs.
 */
export async function resolveCredentials(): Promise<ResolvedCredentials> {
  const tokenInput = core.getInput('token');
  const tempPaths: string[] = [];

  try {
    if (tokenInput) {
      return await resolveFromCiToken(tokenInput, tempPaths);
    }
    return await resolveFromIndividualInputs(tempPaths);
  } catch (error) {
    cleanupPaths(tempPaths);
    throw error;
  }
}

async function resolveFromCiToken(tokenJson: string, tempPaths: string[]): Promise<ResolvedCredentials> {
  let token: CiToken;
  try {
    token = JSON.parse(tokenJson);
  } catch {
    throw new Error('Failed to parse token input as JSON. Expected AUTHS_CI_TOKEN format.');
  }

  if (token.version !== 1) {
    throw new Error(`Unsupported CiToken version: ${token.version}. This action supports version 1.`);
  }

  if (!token.passphrase) throw new Error('CiToken missing required field: passphrase');
  if (!token.keychain) throw new Error('CiToken missing required field: keychain');
  if (!token.identity_repo) throw new Error('CiToken missing required field: identity_repo');

  // Check TTL
  if (token.created_at && token.max_valid_for_secs) {
    const ageSeconds = (Date.now() - new Date(token.created_at).getTime()) / 1000;
    if (ageSeconds > token.max_valid_for_secs) {
      throw new Error(
        `CiToken expired: ${Math.round(ageSeconds)}s old, max ${token.max_valid_for_secs}s. ` +
        `Regenerate with: auths ci setup`
      );
    }
  }

  const tmpBase = path.join(os.tmpdir(), `auths-sign-${Date.now()}`);
  fs.mkdirSync(tmpBase, { recursive: true });
  tempPaths.push(tmpBase);

  // Write keychain
  const keychainPath = path.join(tmpBase, 'ci-keychain.enc');
  fs.writeFileSync(keychainPath, Buffer.from(token.keychain, 'base64'));
  fs.chmodSync(keychainPath, 0o600);

  // Extract identity repo tar.gz
  const identityTarPath = path.join(tmpBase, 'identity.tar.gz');
  fs.writeFileSync(identityTarPath, Buffer.from(token.identity_repo, 'base64'));
  const identityDir = path.join(tmpBase, 'identity');
  fs.mkdirSync(identityDir, { recursive: true });
  await exec.exec('tar', ['-xzf', identityTarPath, '-C', identityDir], { silent: true });
  const identityRepoPath = resolveAuthsDir(identityDir);

  // Write verify bundle (if present)
  let verifyBundlePath = '';
  if (token.verify_bundle && Object.keys(token.verify_bundle).length > 0) {
    verifyBundlePath = path.join(tmpBase, 'verify-bundle.json');
    fs.writeFileSync(verifyBundlePath, JSON.stringify(token.verify_bundle), 'utf8');
  }

  core.setSecret(token.passphrase);

  return { passphrase: token.passphrase, keychainPath, identityRepoPath, verifyBundlePath, tempPaths };
}

async function resolveFromIndividualInputs(tempPaths: string[]): Promise<ResolvedCredentials> {
  const passphrase = core.getInput('passphrase');
  const keychainB64 = core.getInput('keychain');
  const identityRepoB64 = core.getInput('identity-repo');
  const verifyBundleJson = core.getInput('verify-bundle');

  if (!passphrase) throw new Error('Neither token nor passphrase provided. Set the token input or all individual inputs.');
  if (!keychainB64) throw new Error('keychain input is required when using individual inputs.');
  if (!identityRepoB64) throw new Error('identity-repo input is required when using individual inputs.');

  const tmpBase = path.join(os.tmpdir(), `auths-sign-${Date.now()}`);
  fs.mkdirSync(tmpBase, { recursive: true });
  tempPaths.push(tmpBase);

  // Write keychain
  const keychainPath = path.join(tmpBase, 'ci-keychain.enc');
  fs.writeFileSync(keychainPath, Buffer.from(keychainB64.replace(/\s/g, ''), 'base64'));
  fs.chmodSync(keychainPath, 0o600);

  // Extract identity repo
  const identityTarPath = path.join(tmpBase, 'identity.tar.gz');
  fs.writeFileSync(identityTarPath, Buffer.from(identityRepoB64.replace(/\s/g, ''), 'base64'));
  const identityDir = path.join(tmpBase, 'identity');
  fs.mkdirSync(identityDir, { recursive: true });
  await exec.exec('tar', ['-xzf', identityTarPath, '-C', identityDir], { silent: true });
  const identityRepoPath = resolveAuthsDir(identityDir);

  // Write verify bundle (if present)
  let verifyBundlePath = '';
  if (verifyBundleJson) {
    verifyBundlePath = path.join(tmpBase, 'verify-bundle.json');
    fs.writeFileSync(verifyBundlePath, verifyBundleJson, 'utf8');
  }

  core.setSecret(passphrase);

  return { passphrase, keychainPath, identityRepoPath, verifyBundlePath, tempPaths };
}

function resolveAuthsDir(extractedDir: string): string {
  const nested = path.join(extractedDir, '.auths');
  if (fs.existsSync(nested)) return nested;
  return extractedDir;
}

export function cleanupPaths(paths: string[]): void {
  for (const p of paths) {
    try {
      if (fs.existsSync(p)) {
        const stat = fs.statSync(p);
        if (stat.isDirectory()) {
          fs.rmSync(p, { recursive: true, force: true });
        } else {
          fs.unlinkSync(p);
        }
      }
    } catch {
      // Best-effort cleanup
    }
  }
}
