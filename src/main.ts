import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as glob from '@actions/glob';
import * as path from 'path';
import * as fs from 'fs';
import { ensureAuthsInstalled } from './installer';
import { cleanupPaths } from './token';

async function run(): Promise<void> {
  try {
    const filePatterns = core.getMultilineInput('files').filter(p => p.trim());
    const commitsRange = core.getInput('commits').trim();

    if (filePatterns.length === 0 && !commitsRange) {
      throw new Error('At least one of `files` or `commits` must be provided');
    }

    // Install auths CLI
    const version = core.getInput('auths-version') || '';
    const authsPath = await ensureAuthsInstalled(version);
    if (!authsPath) {
      throw new Error('Failed to find or install auths CLI');
    }

    const commitSha = core.getInput('commit-sha') || process.env.GITHUB_SHA || '';
    const note = core.getInput('note') || '';

    const signedFiles: string[] = [];
    const attestationFiles: string[] = [];
    const signedCommits: string[] = [];

    // Sign artifacts with ephemeral keys (no secrets needed)
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

          // Ephemeral CI signing — no secrets, no keychain, no token
          const cliArgs = ['artifact', 'sign', file, '--ci'];
          if (commitSha) cliArgs.push('--commit', commitSha);
          if (note) cliArgs.push('--note', note);

          const exitCode = await exec.exec(authsPath, cliArgs, {
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

    // Sign commits (if commits range provided)
    if (commitsRange) {
      core.info('');
      core.info('=== Commit Signing ===');

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

          const cliArgs = ['artifact', 'sign', '--ci', '--commit', sha];

          const exitCode = await exec.exec(authsPath, cliArgs, {
            ignoreReturnCode: true,
          });

          if (exitCode !== 0) {
            core.warning(`Failed to sign commit ${sha.substring(0, 8)} (exit code ${exitCode})`);
            continue;
          }

          signedCommits.push(sha);
          core.info(`\u2713 Signed commit ${sha.substring(0, 8)}`);
        }
      }
    }

    // Set outputs
    core.setOutput('signed-files', JSON.stringify(signedFiles));
    core.setOutput('attestation-files', JSON.stringify(attestationFiles));
    core.setOutput('signed-commits', JSON.stringify(signedCommits));

    // Step summary
    await writeStepSummary(signedFiles, attestationFiles, signedCommits);

  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed('An unexpected error occurred');
    }
  }
}

async function writeStepSummary(
  signedFiles: string[],
  attestationFiles: string[],
  signedCommits: string[]
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
      lines.push(`| \`${file}\` | \`${attest}\` | \u2705 Signed |`);
    }
    lines.push('');
  }

  if (signedCommits.length > 0) {
    lines.push('### Commits');
    lines.push('');
    lines.push('| Commit | Status |');
    lines.push('|--------|--------|');

    for (const sha of signedCommits) {
      lines.push(`| \`${sha.substring(0, 8)}\` | \u2705 Signed |`);
    }
    lines.push('');
  }

  const totalCount = signedFiles.length + signedCommits.length;
  lines.push(`**${totalCount}** item(s) signed with ephemeral keys. No CI secrets used.`);

  await core.summary.addRaw(lines.join('\n')).write();
}

run();
