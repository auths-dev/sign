import { getAuthsDownloadUrl, getBinaryName, verifyChecksum, ensureAuthsInstalled } from '../installer';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

jest.mock('os', () => {
  const realOs = jest.requireActual('os');
  return {
    platform: jest.fn(),
    arch: jest.fn(),
    homedir: jest.fn(() => '/home/test'),
    tmpdir: jest.fn(() => realOs.tmpdir()),
  };
});

jest.mock('@actions/core', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warning: jest.fn(),
  getInput: jest.fn(() => ''),
}));

jest.mock('@actions/io', () => ({
  which: jest.fn(),
}));

jest.mock('@actions/tool-cache', () => ({
  downloadTool: jest.fn(),
  extractTar: jest.fn(),
  extractZip: jest.fn(),
  cacheDir: jest.fn(),
  find: jest.fn(),
}));

jest.mock('@actions/cache', () => ({
  restoreCache: jest.fn(),
  saveCache: jest.fn(),
}));

const mockOs = require('os');
const mockTc = require('@actions/tool-cache');
const mockCache = require('@actions/cache');
const mockIo = require('@actions/io');

describe('getAuthsDownloadUrl', () => {
  afterEach(() => { jest.resetAllMocks(); });

  it('returns Linux x86_64 tar.gz URL for latest', () => {
    mockOs.platform.mockReturnValue('linux');
    mockOs.arch.mockReturnValue('x64');
    expect(getAuthsDownloadUrl('')).toBe(
      'https://github.com/auths-dev/auths/releases/latest/download/auths-linux-x86_64.tar.gz'
    );
  });

  it('returns macOS aarch64 tar.gz URL for latest', () => {
    mockOs.platform.mockReturnValue('darwin');
    mockOs.arch.mockReturnValue('arm64');
    expect(getAuthsDownloadUrl('')).toBe(
      'https://github.com/auths-dev/auths/releases/latest/download/auths-macos-aarch64.tar.gz'
    );
  });

  it('returns Windows x86_64 zip URL for latest', () => {
    mockOs.platform.mockReturnValue('win32');
    mockOs.arch.mockReturnValue('x64');
    expect(getAuthsDownloadUrl('')).toBe(
      'https://github.com/auths-dev/auths/releases/latest/download/auths-windows-x86_64.zip'
    );
  });

  it('returns versioned URL when version specified', () => {
    mockOs.platform.mockReturnValue('linux');
    mockOs.arch.mockReturnValue('x64');
    expect(getAuthsDownloadUrl('0.5.0')).toBe(
      'https://github.com/auths-dev/auths/releases/download/v0.5.0/auths-linux-x86_64.tar.gz'
    );
  });

  it('returns null for unsupported platform', () => {
    mockOs.platform.mockReturnValue('freebsd');
    mockOs.arch.mockReturnValue('x64');
    expect(getAuthsDownloadUrl('')).toBeNull();
  });

  it('returns null for unsupported architecture', () => {
    mockOs.platform.mockReturnValue('linux');
    mockOs.arch.mockReturnValue('s390x');
    expect(getAuthsDownloadUrl('')).toBeNull();
  });
});

describe('getBinaryName', () => {
  afterEach(() => { jest.resetAllMocks(); });

  it('returns auths.exe on Windows', () => {
    mockOs.platform.mockReturnValue('win32');
    expect(getBinaryName()).toBe('auths.exe');
  });

  it('returns auths on Linux', () => {
    mockOs.platform.mockReturnValue('linux');
    expect(getBinaryName()).toBe('auths');
  });
});

describe('verifyChecksum', () => {
  const testDir = path.join(require('os').tmpdir(), 'auths-sign-test-checksum');

  beforeEach(() => {
    if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });
    jest.resetAllMocks();
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true });
  });

  it('passes when checksum matches', async () => {
    const testFile = path.join(testDir, 'test.tar.gz');
    const content = 'test binary content';
    fs.writeFileSync(testFile, content);
    const hash = crypto.createHash('sha256').update(Buffer.from(content)).digest('hex');
    const checksumFile = path.join(testDir, 'test.tar.gz.sha256');
    fs.writeFileSync(checksumFile, `${hash}  test.tar.gz\n`);
    mockTc.downloadTool.mockResolvedValue(checksumFile);
    await expect(verifyChecksum('https://example.com/test.tar.gz', testFile)).resolves.toBeUndefined();
  });

  it('throws when checksum does not match', async () => {
    const testFile = path.join(testDir, 'test.tar.gz');
    fs.writeFileSync(testFile, 'real content');
    const checksumFile = path.join(testDir, 'test.tar.gz.sha256');
    fs.writeFileSync(checksumFile, 'deadbeef00000000000000000000000000000000000000000000000000000000  test.tar.gz\n');
    mockTc.downloadTool.mockResolvedValue(checksumFile);
    await expect(verifyChecksum('https://example.com/test.tar.gz', testFile)).rejects.toThrow('checksum mismatch');
  });

  it('warns but continues when checksum file not available', async () => {
    const testFile = path.join(testDir, 'test.tar.gz');
    fs.writeFileSync(testFile, 'content');
    mockTc.downloadTool.mockRejectedValue(new Error('HTTP 404'));
    await expect(verifyChecksum('https://example.com/test.tar.gz', testFile)).resolves.toBeUndefined();
  });
});

describe('ensureAuthsInstalled - cross-run caching', () => {
  const realTmpdir = require('os').tmpdir();
  const cachePath = path.join(realTmpdir, 'auths-cache');

  beforeEach(() => {
    jest.resetAllMocks();
    mockIo.which.mockResolvedValue('');
    mockTc.find.mockReturnValue('');
    mockOs.platform.mockReturnValue('linux');
    mockOs.arch.mockReturnValue('x64');
    mockOs.tmpdir.mockReturnValue(realTmpdir);
    if (fs.existsSync(cachePath)) fs.rmSync(cachePath, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(cachePath)) fs.rmSync(cachePath, { recursive: true });
  });

  it('restores from cache on hit', async () => {
    fs.mkdirSync(cachePath, { recursive: true });
    fs.writeFileSync(path.join(cachePath, 'auths'), 'binary-content');
    mockCache.restoreCache.mockResolvedValue('auths-bin-linux-x64-abc123');
    mockTc.cacheDir.mockResolvedValue('/tool-cache/auths/0.5.0');

    const result = await ensureAuthsInstalled('0.5.0');
    expect(mockCache.restoreCache).toHaveBeenCalledTimes(1);
    expect(mockTc.downloadTool).not.toHaveBeenCalled();
    expect(result).toBe('/tool-cache/auths/0.5.0/auths');
  });

  it('downloads and saves to cache on miss', async () => {
    const extractedDir = path.join(realTmpdir, 'auths-extracted');
    fs.mkdirSync(extractedDir, { recursive: true });
    fs.writeFileSync(path.join(extractedDir, 'auths'), 'binary-content');
    mockCache.restoreCache.mockResolvedValue(undefined);
    mockTc.downloadTool.mockResolvedValue('/tmp/download.tar.gz');
    mockTc.extractTar.mockResolvedValue(extractedDir);
    mockCache.saveCache.mockResolvedValue(1);
    mockTc.cacheDir.mockResolvedValue('/tool-cache/auths/0.5.0');

    const result = await ensureAuthsInstalled('0.5.0');
    expect(mockTc.downloadTool).toHaveBeenCalled();
    expect(mockCache.saveCache).toHaveBeenCalledTimes(1);
    expect(result).toBe('/tool-cache/auths/0.5.0/auths');

    if (fs.existsSync(extractedDir)) fs.rmSync(extractedDir, { recursive: true });
  });

  it('skips cross-run cache for latest version', async () => {
    const extractedDir = path.join(realTmpdir, 'auths-extracted-latest');
    fs.mkdirSync(extractedDir, { recursive: true });
    fs.writeFileSync(path.join(extractedDir, 'auths'), 'binary-content');
    mockTc.downloadTool.mockResolvedValue('/tmp/download.tar.gz');
    mockTc.extractTar.mockResolvedValue(extractedDir);
    mockTc.cacheDir.mockResolvedValue('/tool-cache/auths/latest');

    const result = await ensureAuthsInstalled('');
    expect(mockCache.restoreCache).not.toHaveBeenCalled();
    expect(mockCache.saveCache).not.toHaveBeenCalled();
    expect(result).toBe('/tool-cache/auths/latest/auths');

    if (fs.existsSync(extractedDir)) fs.rmSync(extractedDir, { recursive: true });
  });
});
