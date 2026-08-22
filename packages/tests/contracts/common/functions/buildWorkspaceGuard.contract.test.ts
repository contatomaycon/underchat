import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  appendBuildWorkspaceStorageHint,
  BuildWorkspacePreflightError,
  ensureBuildWorkspaceReady,
  isBuildWorkspaceStorageFailure,
} from '@core/common/functions/buildWorkspaceGuard';

interface IMockFilesystemCapacity {
  availableBlocks: bigint;
  blockSize: bigint;
  availableInodes: bigint;
}

function mockFilesystemCapacity(
  input: IMockFilesystemCapacity
): jest.SpyInstance {
  return jest.spyOn(fs, 'statfsSync').mockReturnValue({
    type: 0n,
    bsize: input.blockSize,
    blocks: input.availableBlocks,
    bfree: input.availableBlocks,
    bavail: input.availableBlocks,
    files: input.availableInodes,
    ffree: input.availableInodes,
  } as never);
}

describe('buildWorkspaceGuard contract', () => {
  let workspaceParent: string;

  beforeEach(() => {
    workspaceParent = fs.mkdtempSync(
      path.join(os.tmpdir(), 'underchat-build-workspace-guard-')
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(workspaceParent, { recursive: true, force: true });
  });

  it('accepts a writable workspace with sufficient capacity and removes its probe', () => {
    mockFilesystemCapacity({
      availableBlocks: 1024n,
      blockSize: 4096n,
      availableInodes: 50_000n,
    });

    const capacity = ensureBuildWorkspaceReady({
      workspaceParent,
      minFreeBytes: 2 * 1024 * 1024,
      minFreeInodes: 20_000,
    });

    expect(capacity).toEqual({
      availableBytes: 4_194_304n,
      availableInodes: 50_000n,
    });
    expect(fs.readdirSync(workspaceParent)).toEqual([]);
  });

  it('rejects the workspace before probing when free capacity is insufficient', () => {
    mockFilesystemCapacity({
      availableBlocks: 1n,
      blockSize: 1024n,
      availableInodes: 50_000n,
    });
    const openSpy = jest.spyOn(fs, 'openSync');

    expect(() =>
      ensureBuildWorkspaceReady({
        workspaceParent,
        minFreeBytes: 2048,
        minFreeInodes: 20_000,
      })
    ).toThrow(
      expect.objectContaining({
        name: 'BuildWorkspacePreflightError',
        code: 'BUILD_WORKSPACE_CAPACITY',
      })
    );
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('rejects the workspace before probing when free inodes are insufficient', () => {
    mockFilesystemCapacity({
      availableBlocks: 1024n,
      blockSize: 4096n,
      availableInodes: 19_999n,
    });
    const openSpy = jest.spyOn(fs, 'openSync');

    expect(() =>
      ensureBuildWorkspaceReady({
        workspaceParent,
        minFreeBytes: 2 * 1024 * 1024,
        minFreeInodes: 20_000,
      })
    ).toThrow(
      expect.objectContaining({
        name: 'BuildWorkspacePreflightError',
        code: 'BUILD_WORKSPACE_INODES',
      })
    );
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('wraps a failed durable write probe as a writable-workspace error', () => {
    mockFilesystemCapacity({
      availableBlocks: 1024n,
      blockSize: 4096n,
      availableInodes: 50_000n,
    });
    jest.spyOn(fs, 'openSync').mockImplementation(() => {
      throw Object.assign(new Error('no space left on device'), {
        code: 'ENOSPC',
      });
    });

    expect(() =>
      ensureBuildWorkspaceReady({
        workspaceParent,
        minFreeBytes: 2 * 1024 * 1024,
        minFreeInodes: 20_000,
      })
    ).toThrow(
      expect.objectContaining({
        name: 'BuildWorkspacePreflightError',
        code: 'BUILD_WORKSPACE_NOT_WRITABLE',
        message: expect.stringContaining('no space left on device'),
      })
    );
  });

  it.each([
    'ENOSPC: no space left on device',
    'EDQUOT: disk quota exceeded',
    'EROFS: read-only file system',
    'error: unable to write file packages/schema/example.ts',
    'fatal: unable to checkout working tree',
  ])('classifies storage failure marker: %s', (message) => {
    expect(isBuildWorkspaceStorageFailure(new Error(message))).toBe(true);
  });

  it('classifies preflight failures and appends an actionable storage hint', () => {
    const error = new BuildWorkspacePreflightError(
      'BUILD_WORKSPACE_CAPACITY',
      'workspace is below its reserved capacity'
    );

    expect(isBuildWorkspaceStorageFailure(error)).toBe(true);
    expect(appendBuildWorkspaceStorageHint(error)).toBe(
      `${error.message}\nHint: the build workspace filesystem ran out of writable ` +
        'capacity, inodes, or quota. Free the configured BUILD_GIT_CLONE_DIR ' +
        'or move it to a disk-backed volume before retrying.'
    );
  });

  it('does not classify or decorate an unrelated command failure', () => {
    const error = new Error('registry authentication failed');

    expect(isBuildWorkspaceStorageFailure(error)).toBe(false);
    expect(appendBuildWorkspaceStorageHint(error)).toBe(error.message);
  });
});
