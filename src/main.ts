import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as glob from '@actions/glob';
import * as fs from 'fs';
import * as path from 'path';
import { ensureAuthsInstalled } from './installer';
import { resolveCredentials, cleanupPaths, ResolvedCredentials } from './token';

async function run(): Promise<void> {
  let credentials: ResolvedCredentials | null = null;

  try {
    // 1. Resolve credentials
    credentials = await resolveCredentials();
    core.info('Credentials resolved');

    // 2. Install auths CLI
    const version = core.getInput('auths-version') || '';
    const authsPath = await ensureAuthsInstalled(version);
    if (!authsPath) {
      throw new Error('Failed to find or install auths CLI');
    }

    // 3. Glob match files
    const filePatterns = core.getMultilineInput('files', { required: true });
    const patterns = filePatterns.join('\n');
    const globber = await glob.create(patterns, { followSymbolicLinks: false });
    let files = await globber.glob();

    // Workspace containment check
    const workspace = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
    files = files.filter(f => {
      const resolved = path.resolve(f);
      if (!resolved.startsWith(workspace + path.sep) && resolved !== workspace) {
        core.warning(`Skipping path outside workspace: ${f}`);
        return false;
      }
      return true;
    });

    files = [...new Set(files)];

    if (files.length === 0) {
      throw new Error('No files matched the provided glob patterns');
    }

    core.info(`Found ${files.length} file(s) to sign`);

    // 4. Sign each file
    const deviceKey = core.getInput('device-key') || 'ci-release-device';
    const note = core.getInput('note') || '';
    const signedFiles: string[] = [];
    const attestationFiles: string[] = [];

    for (const file of files) {
      core.info(`Signing: ${path.basename(file)}`);

      const cliArgs = [
        'artifact', 'sign', file,
        '--device-key', deviceKey,
        '--repo', credentials.identityRepoPath,
      ];
      if (note) cliArgs.push('--note', note);

      const exitCode = await exec.exec(authsPath, cliArgs, {
        env: {
          ...process.env,
          AUTHS_PASSPHRASE: credentials.passphrase,
          AUTHS_KEYCHAIN_BACKEND: 'file',
          AUTHS_KEYCHAIN_FILE: credentials.keychainPath,
        },
        ignoreReturnCode: true,
      });

      if (exitCode !== 0) {
        throw new Error(`Failed to sign ${path.basename(file)} (exit code ${exitCode})`);
      }

      const attestationPath = `${file}.auths.json`;
      if (!fs.existsSync(attestationPath)) {
        throw new Error(`Signing succeeded but attestation file not found: ${attestationPath}`);
      }

      signedFiles.push(file);
      attestationFiles.push(attestationPath);
      core.info(`\u2713 ${path.basename(file)} -> ${path.basename(attestationPath)}`);
    }

    // 5. Optionally verify
    const shouldVerify = core.getInput('verify') === 'true';
    let allVerified = true;

    if (shouldVerify) {
      if (!credentials.verifyBundlePath) {
        core.warning('verify: true requested but no verify bundle available. Provide verify_bundle in the CiToken or set the verify-bundle input.');
        allVerified = false;
      } else {
        core.info('');
        core.info('=== Post-Sign Verification ===');

        for (const file of signedFiles) {
          const result = await exec.getExecOutput(
            authsPath,
            ['artifact', 'verify', file, '--identity-bundle', credentials.verifyBundlePath, '--json'],
            { ignoreReturnCode: true, silent: true }
          );

          if (result.stdout.trim()) {
            try {
              const parsed = JSON.parse(result.stdout.trim());
              if (parsed.valid === true) {
                core.info(`\u2713 Verified ${path.basename(file)}${parsed.issuer ? ` (issuer: ${parsed.issuer})` : ''}`);
              } else {
                core.warning(`\u2717 ${path.basename(file)}: ${parsed.error || 'verification returned valid=false'}`);
                allVerified = false;
              }
            } catch {
              core.warning(`\u2717 ${path.basename(file)}: could not parse verification output`);
              allVerified = false;
            }
          } else {
            core.warning(`\u2717 ${path.basename(file)}: ${result.stderr.trim() || `exit code ${result.exitCode}`}`);
            allVerified = false;
          }
        }
      }
    }

    // 6. Set outputs
    core.setOutput('signed-files', JSON.stringify(signedFiles));
    core.setOutput('attestation-files', JSON.stringify(attestationFiles));
    core.setOutput('verified', shouldVerify ? allVerified.toString() : '');

    // 7. Step summary
    await writeStepSummary(signedFiles, attestationFiles, shouldVerify, allVerified);

    // 8. Fail if verification was requested and failed
    if (shouldVerify && !allVerified) {
      core.setFailed('Post-sign verification failed for one or more files');
    }

  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed('An unexpected error occurred');
    }
  } finally {
    if (credentials) {
      cleanupPaths(credentials.tempPaths);
    }
  }
}

async function writeStepSummary(
  signedFiles: string[],
  attestationFiles: string[],
  verified: boolean,
  allVerified: boolean
): Promise<void> {
  if (signedFiles.length === 0) return;

  const lines: string[] = [];
  lines.push('## Auths Artifact Signing');
  lines.push('');
  lines.push('| Artifact | Attestation | Status |');
  lines.push('|----------|-------------|--------|');

  for (let i = 0; i < signedFiles.length; i++) {
    const file = path.basename(signedFiles[i]);
    const attest = path.basename(attestationFiles[i]);
    const status = verified
      ? (allVerified ? '\u2705 Signed + Verified' : '\u26a0\ufe0f Signed (verify failed)')
      : '\u2705 Signed';
    lines.push(`| \`${file}\` | \`${attest}\` | ${status} |`);
  }

  lines.push('');
  lines.push(`**${signedFiles.length}** artifact(s) signed`);
  if (verified) {
    lines.push(allVerified ? '**Verification:** All passed' : '**Verification:** Failed');
  }

  await core.summary.addRaw(lines.join('\n')).write();
}

run();
