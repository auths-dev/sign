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
    // Validate: at least one of files or commits must be provided
    const filePatterns = core.getMultilineInput('files').filter(p => p.trim());
    const commitsRange = core.getInput('commits').trim();

    if (filePatterns.length === 0 && !commitsRange) {
      throw new Error('At least one of `files` or `commits` must be provided');
    }

    // 1. Resolve credentials
    credentials = await resolveCredentials();
    core.info('Credentials resolved');

    // 2. Install auths CLI
    const version = core.getInput('auths-version') || '';
    const authsPath = await ensureAuthsInstalled(version);
    if (!authsPath) {
      throw new Error('Failed to find or install auths CLI');
    }

    const deviceKey = core.getInput('device-key') || 'ci-release-device';
    const note = core.getInput('note') || '';
    const shouldVerify = core.getInput('verify') === 'true';
    let allVerified = true;

    const signedFiles: string[] = [];
    const attestationFiles: string[] = [];
    const signedCommits: string[] = [];

    const authsEnv = {
      ...process.env,
      AUTHS_PASSPHRASE: credentials.passphrase,
      AUTHS_KEYCHAIN_BACKEND: 'file',
      AUTHS_KEYCHAIN_FILE: credentials.keychainPath,
    };

    // 3. Sign artifacts (if files provided)
    if (filePatterns.length > 0) {
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
        core.warning('No files matched the provided glob patterns');
      } else {
        core.info(`Found ${files.length} file(s) to sign`);

        for (const file of files) {
          core.info(`Signing: ${path.basename(file)}`);

          const cliArgs = [
            'artifact', 'sign', file,
            '--device-key', deviceKey,
            '--repo', credentials.identityRepoPath,
          ];
          if (note) cliArgs.push('--note', note);

          const exitCode = await exec.exec(authsPath, cliArgs, {
            env: authsEnv,
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
      }
    }

    // 4. Sign commits (if commits range provided)
    if (commitsRange) {
      core.info('');
      core.info('=== Commit Signing ===');

      // Enumerate commits in range (skip merges)
      const revListResult = await exec.getExecOutput(
        'git', ['rev-list', '--no-merges', commitsRange],
        { ignoreReturnCode: true, silent: true }
      );

      if (revListResult.exitCode !== 0) {
        throw new Error(`Failed to enumerate commits in range '${commitsRange}': ${revListResult.stderr.trim()}`);
      }

      const commitShas = revListResult.stdout.trim().split('\n').filter(s => s.length > 0);

      if (commitShas.length === 0) {
        core.info('No commits found in range (or all are merge commits)');
      } else {
        core.info(`Found ${commitShas.length} commit(s) to sign`);

        for (const sha of commitShas) {
          core.info(`Signing commit: ${sha.substring(0, 8)}`);

          const cliArgs = [
            'signcommit', sha,
            '--device-key', deviceKey,
            '--repo', credentials.identityRepoPath,
          ];

          const exitCode = await exec.exec(authsPath, cliArgs, {
            env: authsEnv,
            ignoreReturnCode: true,
          });

          if (exitCode !== 0) {
            core.warning(`Failed to sign commit ${sha.substring(0, 8)} (exit code ${exitCode})`);
            continue;
          }

          signedCommits.push(sha);
          core.info(`\u2713 Signed commit ${sha.substring(0, 8)}`);
        }

        // Push attestation refs
        if (signedCommits.length > 0) {
          core.info('Pushing attestation refs...');
          const pushResult = await exec.exec(
            'git', ['push', 'origin', 'refs/auths/commits/*:refs/auths/commits/*'],
            { ignoreReturnCode: true }
          );

          if (pushResult !== 0) {
            core.warning('Failed to push attestation refs (may not have contents: write permission)');
          } else {
            core.info(`\u2713 Pushed attestation refs for ${signedCommits.length} commit(s)`);
          }

          // Also push KERI refs if they exist
          const keriCheck = await exec.getExecOutput(
            'git', ['show-ref', '--heads', '--tags'],
            { ignoreReturnCode: true, silent: true }
          );
          if (keriCheck.stdout.includes('refs/keri')) {
            await exec.exec('git', ['push', 'origin', 'refs/keri/*:refs/keri/*'], {
              ignoreReturnCode: true,
            });
          }
        }
      }
    }

    // 5. Optionally verify
    if (shouldVerify) {
      // Verify artifacts
      if (signedFiles.length > 0) {
        if (!credentials.verifyBundlePath) {
          core.warning('verify: true requested but no verify bundle available for artifacts.');
          allVerified = false;
        } else {
          core.info('');
          core.info('=== Post-Sign Artifact Verification ===');

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

      // Verify commits
      if (signedCommits.length > 0) {
        core.info('');
        core.info('=== Post-Sign Commit Verification ===');

        for (const sha of signedCommits) {
          const verifyArgs = ['verify-commit', sha];
          if (credentials.verifyBundlePath) {
            verifyArgs.push('--identity-bundle', credentials.verifyBundlePath);
          }

          const result = await exec.exec(authsPath, verifyArgs, {
            env: authsEnv,
            ignoreReturnCode: true,
          });

          if (result === 0) {
            core.info(`\u2713 Verified commit ${sha.substring(0, 8)}`);
          } else {
            core.warning(`\u2717 Commit ${sha.substring(0, 8)} verification failed`);
            allVerified = false;
          }
        }
      }
    }

    // 6. Set outputs
    core.setOutput('signed-files', JSON.stringify(signedFiles));
    core.setOutput('attestation-files', JSON.stringify(attestationFiles));
    core.setOutput('signed-commits', JSON.stringify(signedCommits));
    core.setOutput('verified', shouldVerify ? allVerified.toString() : '');

    // 7. Step summary
    await writeStepSummary(signedFiles, attestationFiles, signedCommits, shouldVerify, allVerified);

    // 8. Fail if verification was requested and failed
    if (shouldVerify && !allVerified) {
      core.setFailed('Post-sign verification failed for one or more artifacts/commits');
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
  signedCommits: string[],
  verified: boolean,
  allVerified: boolean
): Promise<void> {
  if (signedFiles.length === 0 && signedCommits.length === 0) return;

  const lines: string[] = [];
  lines.push('## Auths Signing');
  lines.push('');

  if (signedFiles.length > 0) {
    lines.push('### Artifacts');
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
  }

  if (signedCommits.length > 0) {
    lines.push('### Commits');
    lines.push('');
    lines.push('| Commit | Status |');
    lines.push('|--------|--------|');

    for (const sha of signedCommits) {
      const status = verified
        ? (allVerified ? '\u2705 Signed + Verified' : '\u26a0\ufe0f Signed')
        : '\u2705 Signed';
      lines.push(`| \`${sha.substring(0, 8)}\` | ${status} |`);
    }
    lines.push('');
  }

  const totalCount = signedFiles.length + signedCommits.length;
  lines.push(`**${totalCount}** item(s) signed`);
  if (verified) {
    lines.push(allVerified ? '**Verification:** All passed' : '**Verification:** Failed');
  }

  await core.summary.addRaw(lines.join('\n')).write();
}

run();
