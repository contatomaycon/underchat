import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  retryLegacySessionVolumeSnapshot,
  snapshotLegacySessionVolume,
} from '@core/services/sessionStorageMigrationSnapshot.service';

describe('legacy session volume snapshot', () => {
  let root = '';

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'underchat-legacy-session-'));
  });

  afterEach(async () => {
    await rm(root, { force: true, recursive: true });
  });

  it('is deterministic across directory enumeration order and changes with bytes', async () => {
    await mkdir(join(root, 'nested'));
    await writeFile(join(root, 'z.json'), '{"z":1}');
    await writeFile(join(root, 'nested', 'a.json'), '{"a":1}');

    const first = await snapshotLegacySessionVolume(root);
    const second = await snapshotLegacySessionVolume(root);
    expect(second).toEqual(first);
    expect(first.recordCount).toBe(2);
    expect(first.checksumSha256).toMatch(/^[0-9a-f]{64}$/u);

    await writeFile(join(root, 'nested', 'a.json'), '{"a":2}');
    const changed = await snapshotLegacySessionVolume(root);
    expect(changed.checksumSha256).not.toBe(first.checksumSha256);
  });

  it('fails closed for symlinks instead of following data outside the volume', async () => {
    await writeFile(join(root, 'session.json'), '{}');
    await symlink(join(root, 'session.json'), join(root, 'alias.json'));
    await expect(snapshotLegacySessionVolume(root)).rejects.toThrow(
      'legacy_session_snapshot_symlink_forbidden'
    );
  });

  it('retries only a bounded transient ENOENT after provider quiescence', async () => {
    const proof = {
      checksumSha256: 'a'.repeat(64),
      sizeBytes: 42,
      recordCount: 3,
    };
    const snapshot = jest
      .fn<Promise<typeof proof>, []>()
      .mockRejectedValueOnce(
        Object.assign(new Error('vanished'), { code: 'ENOENT' })
      )
      .mockResolvedValueOnce(proof);

    await expect(
      retryLegacySessionVolumeSnapshot(snapshot, { retryDelayMs: 0 })
    ).resolves.toEqual(proof);
    expect(snapshot).toHaveBeenCalledTimes(2);
  });

  it('keeps integrity errors fail-closed without retrying', async () => {
    const snapshot = jest
      .fn<Promise<never>, []>()
      .mockRejectedValue(
        new Error('legacy_session_snapshot_symlink_forbidden')
      );

    await expect(
      retryLegacySessionVolumeSnapshot(snapshot, { retryDelayMs: 0 })
    ).rejects.toThrow('legacy_session_snapshot_symlink_forbidden');
    expect(snapshot).toHaveBeenCalledTimes(1);
  });
});
