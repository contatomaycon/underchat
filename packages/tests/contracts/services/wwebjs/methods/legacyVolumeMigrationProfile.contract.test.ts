import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { withWritableWwebjsLegacyProfileCopy } from '@core/services/wwebjs/methods/legacyVolumeMigrationProfile';

describe('withWritableWwebjsLegacyProfileCopy', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'underchat-wwebjs-legacy-source-')
    );
  });

  afterEach(async () => {
    await fs.promises.rm(root, { recursive: true, force: true });
  });

  it('isolates the profile, discards stale revision ownership, and cleans up', async () => {
    const source = path.join(root, 'profile');
    const sourceFingerprint = path.join(source, '.wwebjs-profile-fingerprint');
    await fs.promises.mkdir(path.join(source, 'Default', 'IndexedDB'), {
      recursive: true,
    });
    await fs.promises.writeFile(
      path.join(source, 'Default', 'IndexedDB', 'session.data'),
      'legacy-session'
    );
    await fs.promises.writeFile(sourceFingerprint, Buffer.alloc(32, 1));

    let stagingRoot: string | undefined;
    await expect(
      withWritableWwebjsLegacyProfileCopy(source, async (staging) => {
        stagingRoot = path.dirname(staging);
        await expect(
          fs.promises.stat(sourceFingerprint)
        ).resolves.toBeDefined();
        await expect(
          fs.promises.stat(path.join(staging, '.wwebjs-profile-fingerprint'))
        ).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(
          fs.promises.readFile(
            path.join(staging, 'Default', 'IndexedDB', 'session.data'),
            'utf8'
          )
        ).resolves.toBe('legacy-session');
        await fs.promises.writeFile(
          path.join(staging, '.wwebjs-profile-fingerprint'),
          Buffer.alloc(32, 2)
        );
        return 'staged';
      })
    ).resolves.toBe('staged');

    if (!stagingRoot) throw new Error('staging_root_not_observed');
    await expect(fs.promises.stat(stagingRoot)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(fs.promises.readFile(sourceFingerprint)).resolves.toEqual(
      Buffer.alloc(32, 1)
    );
  });

  it('cleans the writable copy when checkpointing fails', async () => {
    const source = path.join(root, 'profile');
    await fs.promises.mkdir(source, { recursive: true });
    await fs.promises.writeFile(path.join(source, 'Local State'), '{}');
    let stagingRoot: string | undefined;

    await expect(
      withWritableWwebjsLegacyProfileCopy(source, async (staging) => {
        stagingRoot = path.dirname(staging);
        throw new Error('checkpoint_failed');
      })
    ).rejects.toThrow('checkpoint_failed');

    if (!stagingRoot) throw new Error('staging_root_not_observed');
    await expect(fs.promises.stat(stagingRoot)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('rejects a missing source before allocating staging storage', async () => {
    await expect(
      withWritableWwebjsLegacyProfileCopy(
        path.join(root, 'missing'),
        async () => undefined
      )
    ).rejects.toThrow('legacy_session_migration_profile_missing');
  });
});
