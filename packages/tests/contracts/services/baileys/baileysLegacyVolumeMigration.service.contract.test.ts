import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BaileysLegacyVolumeMigrationError,
  readBaileysLegacyVolumeAuthFiles,
} from '@core/services/baileys/baileysLegacyVolumeMigration.service';
import { workerErrorDiagnostics } from '@core/common/functions/workerErrorDiagnostics';

describe('readBaileysLegacyVolumeAuthFiles', () => {
  const roots: string[] = [];

  const makeRoot = async (): Promise<string> => {
    const root = await mkdtemp(join(tmpdir(), 'baileys-legacy-volume-'));
    roots.push(root);
    return root;
  };

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
    );
  });

  it('reads the older flat multi-file auth layout', async () => {
    const root = await makeRoot();
    await writeFile(join(root, 'creds.json'), '{"registered":true}');
    await writeFile(join(root, 'app-state-sync-key-1.json'), '{"key":1}');

    await expect(
      readBaileysLegacyVolumeAuthFiles(root, 'worker-b')
    ).resolves.toEqual({
      'app-state-sync-key-1.json': '{"key":1}',
      'creds.json': '{"registered":true}',
    });
  });

  it('reads the current whole-volume storage/<worker-id> layout', async () => {
    const root = await makeRoot();
    const authRoot = join(root, 'storage', 'worker-b');
    await mkdir(authRoot, { recursive: true });
    await writeFile(join(authRoot, 'creds.json'), '{"registered":true}');
    await writeFile(join(authRoot, 'session-peer.json'), '{"session":1}');

    await expect(
      readBaileysLegacyVolumeAuthFiles(root, 'worker-b')
    ).resolves.toEqual({
      'creds.json': '{"registered":true}',
      'session-peer.json': '{"session":1}',
    });
  });

  it.each([
    [
      'another worker in storage',
      async (root: string) => {
        const authRoot = join(root, 'storage', 'worker-other');
        await mkdir(authRoot, { recursive: true });
        await writeFile(join(authRoot, 'creds.json'), '{}');
      },
    ],
    [
      'an extra worker in storage',
      async (root: string) => {
        for (const worker of ['worker-b', 'worker-other']) {
          const authRoot = join(root, 'storage', worker);
          await mkdir(authRoot, { recursive: true });
          await writeFile(join(authRoot, 'creds.json'), '{}');
        }
      },
    ],
    [
      'a mixed flat and nested layout',
      async (root: string) => {
        const authRoot = join(root, 'storage', 'worker-b');
        await mkdir(authRoot, { recursive: true });
        await writeFile(join(authRoot, 'creds.json'), '{}');
        await writeFile(join(root, 'creds.json'), '{}');
      },
    ],
    [
      'a non-json file',
      async (root: string) => {
        await writeFile(join(root, 'creds.json'), '{}');
        await writeFile(join(root, 'unexpected.txt'), 'unexpected');
      },
    ],
  ])('rejects %s without guessing', async (_name, arrange) => {
    const root = await makeRoot();
    await arrange(root);

    await expect(
      readBaileysLegacyVolumeAuthFiles(root, 'worker-b')
    ).rejects.toMatchObject({
      name: 'BaileysLegacyVolumeMigrationError',
      code: 'ERR_LEGACY_SESSION_MIGRATION_LAYOUT_INVALID',
    });
  });

  it('rejects an empty auth layout', async () => {
    const root = await makeRoot();

    await expect(
      readBaileysLegacyVolumeAuthFiles(root, 'worker-b')
    ).rejects.toEqual(
      expect.objectContaining<Partial<BaileysLegacyVolumeMigrationError>>({
        code: 'ERR_LEGACY_SESSION_MIGRATION_LAYOUT_EMPTY',
      })
    );
  });

  it('rejects a symlinked auth file', async () => {
    const root = await makeRoot();
    const target = join(root, 'target.json');
    await writeFile(target, '{}');
    await symlink(target, join(root, 'creds.json'));

    await expect(
      readBaileysLegacyVolumeAuthFiles(root, 'worker-b')
    ).rejects.toMatchObject({
      code: 'ERR_LEGACY_SESSION_MIGRATION_LAYOUT_INVALID',
    });
  });

  it('rejects a worker id that escapes the storage root', async () => {
    const root = await makeRoot();
    await mkdir(join(root, 'storage'), { recursive: true });

    await expect(
      readBaileysLegacyVolumeAuthFiles(root, '../worker-b')
    ).rejects.toMatchObject({
      code: 'ERR_LEGACY_SESSION_MIGRATION_CONTEXT_INVALID',
    });
  });

  it('exposes only a stable application-owned diagnostic code', () => {
    expect(
      workerErrorDiagnostics(
        new BaileysLegacyVolumeMigrationError(
          'legacy_session_migration_layout_invalid'
        )
      )
    ).toEqual({
      error_name: 'baileys_legacy_volume_migration_error',
      error_code: 'err_legacy_session_migration_layout_invalid',
    });
  });
});
