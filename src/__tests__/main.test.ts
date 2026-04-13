/**
 * Integration tests for the sign action's ephemeral signing flow.
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

jest.mock('../token', () => ({
  cleanupPaths: jest.fn(),
}));

jest.mock('../installer', () => ({
  ensureAuthsInstalled: jest.fn().mockResolvedValue('/usr/bin/auths'),
}));

function resetMockState() {
  mockInputs = {
    'auths-version': '',
    'commit-sha': 'abc123',
    'note': '',
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
}

async function runMain() {
  return jest.isolateModulesAsync(async () => {
    require('../main');
    await new Promise(resolve => setTimeout(resolve, 50));
  });
}

describe('Sign action integration (ephemeral)', () => {
  beforeEach(() => {
    resetMockState();
    jest.clearAllMocks();
    process.env.GITHUB_WORKSPACE = '/workspace';
    process.env.GITHUB_SHA = 'abc123def456';
  });

  afterEach(() => {
    delete process.env.GITHUB_WORKSPACE;
    delete process.env.GITHUB_SHA;
  });

  it('signs files with --ci flag and sets outputs', async () => {
    await runMain();

    expect(mockFailed).toHaveLength(0);
    const signed = JSON.parse(mockOutputs['signed-files']);
    expect(signed).toEqual(['/workspace/dist/index.js']);
    const attestations = JSON.parse(mockOutputs['attestation-files']);
    expect(attestations).toEqual(['/workspace/dist/index.js.auths.json']);
  });

  it('fails when no files or commits provided', async () => {
    mockMultilineInputs['files'] = [];
    mockInputs['commits'] = '';

    await runMain();

    expect(mockFailed).toHaveLength(1);
    expect(mockFailed[0]).toContain('files');
  });

  it('warns when glob matches no files', async () => {
    mockGlobFiles = [];

    await runMain();

    expect(mockWarnings.some(w => w.includes('No files matched'))).toBe(true);
  });

  it('fails when signing exits non-zero', async () => {
    mockExecExitCode = 1;

    await runMain();

    expect(mockFailed).toHaveLength(1);
    expect(mockFailed[0]).toContain('Failed to sign');
  });
});
