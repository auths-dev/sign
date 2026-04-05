/**
 * Integration tests for the sign action's run() flow.
 * Since run() executes at import time, we use jest.isolateModulesAsync.
 */

let mockInputs: Record<string, string> = {};
let mockMultilineInputs: Record<string, string[]> = {};
let mockOutputs: Record<string, string> = {};
let mockFailed: string[] = [];
let mockWarnings: string[] = [];
let mockGlobFiles: string[] = [];
let mockExecExitCode = 0;
let mockExecOutputResult = { exitCode: 0, stdout: '', stderr: '' };

jest.mock('@actions/core', () => ({
  getInput: jest.fn((name: string) => mockInputs[name] || ''),
  getMultilineInput: jest.fn((name: string) => mockMultilineInputs[name] || []),
  setOutput: jest.fn((name: string, value: string) => { mockOutputs[name] = value; }),
  setFailed: jest.fn((msg: string) => { mockFailed.push(msg); }),
  setSecret: jest.fn(),
  info: jest.fn(),
  warning: jest.fn((msg: string) => { mockWarnings.push(typeof msg === 'string' ? msg : ''); }),
  error: jest.fn(),
  debug: jest.fn(),
  summary: {
    addRaw: jest.fn().mockReturnThis(),
    write: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('@actions/exec', () => ({
  exec: jest.fn().mockImplementation(async () => mockExecExitCode),
  getExecOutput: jest.fn().mockImplementation(async () => mockExecOutputResult),
}));

jest.mock('@actions/glob', () => ({
  create: jest.fn().mockImplementation(async () => ({
    glob: jest.fn().mockResolvedValue(mockGlobFiles),
  })),
}));

jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    existsSync: jest.fn((p: string) => {
      if (p.includes('.auths.json')) return true;
      return actual.existsSync(p);
    }),
  };
});

const mockResolveCredentials = jest.fn();
const mockCleanupPaths = jest.fn();

jest.mock('../token', () => ({
  resolveCredentials: () => mockResolveCredentials(),
  cleanupPaths: (...args: any[]) => mockCleanupPaths(...args),
}));

jest.mock('../installer', () => ({
  ensureAuthsInstalled: jest.fn().mockResolvedValue('/usr/bin/auths'),
}));

function resetMockState() {
  mockInputs = {
    'auths-version': '',
    'device-key': 'ci-release-device',
    'note': '',
    'verify': 'false',
  };
  mockMultilineInputs = {
    'files': ['dist/*.js'],
  };
  mockOutputs = {};
  mockFailed = [];
  mockWarnings = [];
  mockGlobFiles = ['/workspace/dist/index.js'];
  mockExecExitCode = 0;
  mockExecOutputResult = { exitCode: 0, stdout: '', stderr: '' };

  mockResolveCredentials.mockResolvedValue({
    passphrase: 'test-pass',
    keychainPath: '/tmp/keychain',
    identityRepoPath: '/tmp/identity',
    verifyBundlePath: '/tmp/bundle.json',
    tempPaths: ['/tmp/auths-sign-test'],
  });
  mockCleanupPaths.mockReset();
}

async function runMain() {
  return jest.isolateModulesAsync(async () => {
    require('../main');
    await new Promise(resolve => setTimeout(resolve, 50));
  });
}

describe('Sign action integration', () => {
  beforeEach(() => {
    resetMockState();
    jest.clearAllMocks();
    process.env.GITHUB_WORKSPACE = '/workspace';
  });

  afterEach(() => {
    delete process.env.GITHUB_WORKSPACE;
  });

  it('signs files and sets outputs', async () => {
    await runMain();

    expect(mockFailed).toHaveLength(0);
    const signed = JSON.parse(mockOutputs['signed-files']);
    expect(signed).toEqual(['/workspace/dist/index.js']);
    const attestations = JSON.parse(mockOutputs['attestation-files']);
    expect(attestations).toEqual(['/workspace/dist/index.js.auths.json']);
  });

  it('fails when no files match glob', async () => {
    mockGlobFiles = [];

    await runMain();

    expect(mockFailed).toContain('No files matched the provided glob patterns');
  });

  it('fails when signing returns non-zero exit code', async () => {
    mockExecExitCode = 1;

    await runMain();

    expect(mockFailed.some(m => m.includes('Failed to sign'))).toBe(true);
  });

  it('verifies after signing when verify: true', async () => {
    mockInputs['verify'] = 'true';
    mockExecOutputResult = {
      exitCode: 0,
      stdout: JSON.stringify({ valid: true, issuer: 'did:test:123' }),
      stderr: '',
    };

    await runMain();

    expect(mockOutputs['verified']).toBe('true');
    expect(mockFailed).toHaveLength(0);
  });

  it('fails when verification fails', async () => {
    mockInputs['verify'] = 'true';
    mockExecOutputResult = {
      exitCode: 1,
      stdout: JSON.stringify({ valid: false, error: 'digest mismatch' }),
      stderr: '',
    };

    await runMain();

    expect(mockOutputs['verified']).toBe('false');
    expect(mockFailed).toContain('Post-sign verification failed for one or more files');
  });

  it('warns when verify requested but no bundle', async () => {
    mockInputs['verify'] = 'true';
    mockResolveCredentials.mockResolvedValue({
      passphrase: 'test-pass',
      keychainPath: '/tmp/keychain',
      identityRepoPath: '/tmp/identity',
      verifyBundlePath: '',
      tempPaths: ['/tmp/auths-sign-test'],
    });

    await runMain();

    expect(mockWarnings.some(w => w.includes('no verify bundle'))).toBe(true);
  });

  it('filters paths outside workspace', async () => {
    mockGlobFiles = ['/workspace/dist/index.js', '/etc/passwd'];

    await runMain();

    expect(mockWarnings.some(w => w.includes('Skipping path outside workspace'))).toBe(true);
    const signed = JSON.parse(mockOutputs['signed-files']);
    expect(signed).toEqual(['/workspace/dist/index.js']);
  });

  it('always cleans up temp files', async () => {
    mockExecExitCode = 1; // Force failure

    await runMain();

    expect(mockCleanupPaths).toHaveBeenCalled();
  });
});
