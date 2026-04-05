import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('@actions/core', () => ({
  getInput: jest.fn(() => ''),
  setSecret: jest.fn(),
  info: jest.fn(),
  warning: jest.fn(),
}));

jest.mock('@actions/exec', () => ({
  exec: jest.fn().mockResolvedValue(0),
}));

const mockCore = require('@actions/core');

import { resolveCredentials, cleanupPaths } from '../token';

function makeCiToken(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 1,
    passphrase: 'test-pass',
    keychain: Buffer.from('fake-keychain').toString('base64'),
    identity_repo: Buffer.from('fake-tar-gz').toString('base64'),
    verify_bundle: { identity_did: 'did:test:123' },
    created_at: new Date().toISOString(),
    max_valid_for_secs: 31536000,
    ...overrides,
  });
}

describe('resolveCredentials', () => {
  afterEach(() => { jest.resetAllMocks(); });

  describe('CiToken mode', () => {
    it('parses valid CiToken', async () => {
      const token = makeCiToken();
      mockCore.getInput.mockImplementation((name: string) => name === 'token' ? token : '');

      const creds = await resolveCredentials();

      expect(creds.passphrase).toBe('test-pass');
      expect(creds.keychainPath).toBeTruthy();
      expect(fs.existsSync(creds.keychainPath)).toBe(true);
      expect(creds.verifyBundlePath).toBeTruthy();
      expect(mockCore.setSecret).toHaveBeenCalledWith('test-pass');

      cleanupPaths(creds.tempPaths);
    });

    it('rejects expired CiToken', async () => {
      const token = makeCiToken({
        created_at: '2020-01-01T00:00:00Z',
        max_valid_for_secs: 1,
      });
      mockCore.getInput.mockImplementation((name: string) => name === 'token' ? token : '');

      await expect(resolveCredentials()).rejects.toThrow('expired');
    });

    it('rejects invalid JSON', async () => {
      mockCore.getInput.mockImplementation((name: string) => name === 'token' ? 'not-json' : '');

      await expect(resolveCredentials()).rejects.toThrow('Failed to parse');
    });

    it('rejects unsupported version', async () => {
      const token = makeCiToken({ version: 99 });
      mockCore.getInput.mockImplementation((name: string) => name === 'token' ? token : '');

      await expect(resolveCredentials()).rejects.toThrow('Unsupported CiToken version');
    });

    it('rejects token missing passphrase', async () => {
      const token = makeCiToken({ passphrase: '' });
      mockCore.getInput.mockImplementation((name: string) => name === 'token' ? token : '');

      await expect(resolveCredentials()).rejects.toThrow('passphrase');
    });

    it('works without verify_bundle', async () => {
      const token = makeCiToken({ verify_bundle: {} });
      mockCore.getInput.mockImplementation((name: string) => name === 'token' ? token : '');

      const creds = await resolveCredentials();
      expect(creds.verifyBundlePath).toBe('');

      cleanupPaths(creds.tempPaths);
    });
  });

  describe('Individual inputs mode', () => {
    it('resolves from individual inputs', async () => {
      mockCore.getInput.mockImplementation((name: string) => {
        switch (name) {
          case 'token': return '';
          case 'passphrase': return 'my-pass';
          case 'keychain': return Buffer.from('fake-keychain').toString('base64');
          case 'identity-repo': return Buffer.from('fake-tar-gz').toString('base64');
          case 'verify-bundle': return '{"identity_did":"did:test:456"}';
          default: return '';
        }
      });

      const creds = await resolveCredentials();
      expect(creds.passphrase).toBe('my-pass');
      expect(creds.verifyBundlePath).toBeTruthy();

      cleanupPaths(creds.tempPaths);
    });

    it('throws when passphrase is missing', async () => {
      mockCore.getInput.mockImplementation((name: string) => {
        if (name === 'token') return '';
        return '';
      });

      await expect(resolveCredentials()).rejects.toThrow('passphrase');
    });
  });
});

describe('cleanupPaths', () => {
  it('removes files and directories', () => {
    const tmpDir = path.join(os.tmpdir(), 'auths-cleanup-test');
    fs.mkdirSync(tmpDir, { recursive: true });
    const tmpFile = path.join(tmpDir, 'test.txt');
    fs.writeFileSync(tmpFile, 'test');

    cleanupPaths([tmpFile, tmpDir]);

    expect(fs.existsSync(tmpFile)).toBe(false);
    expect(fs.existsSync(tmpDir)).toBe(false);
  });

  it('silently ignores non-existent paths', () => {
    expect(() => cleanupPaths(['/nonexistent/path/abc'])).not.toThrow();
  });
});
