import 'reflect-metadata';
import { EServerBuildType } from '@core/common/enums/EServerBuildType';
import { IHarborArtifactTag } from '@core/common/interfaces/IHarborArtifactTag';
import { ServerBuildHarborService } from '@core/services/serverBuildHarbor.service';

describe('ServerBuildHarborService pairing contract', () => {
  const originalEnvironment = {
    namespace: process.env.HARBOR_NAMESPACE,
    password: process.env.HARBOR_PASSWORD,
    registry: process.env.HARBOR_REGISTRY,
    username: process.env.HARBOR_USERNAME,
  };

  beforeEach(() => {
    process.env.HARBOR_REGISTRY = 'harbor.devunder.com';
    process.env.HARBOR_NAMESPACE = 'underchat/balance';
    process.env.HARBOR_USERNAME = 'robot';
    process.env.HARBOR_PASSWORD = 'secret';
  });

  afterAll(() => {
    const restore = (key: string, value: string | undefined): void => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    };

    restore('HARBOR_NAMESPACE', originalEnvironment.namespace);
    restore('HARBOR_PASSWORD', originalEnvironment.password);
    restore('HARBOR_REGISTRY', originalEnvironment.registry);
    restore('HARBOR_USERNAME', originalEnvironment.username);
  });

  it('returns solitary images from every build repository', async () => {
    const service = new ServerBuildHarborService();
    const tagsByImage: Record<string, IHarborArtifactTag[]> = {
      'under-worker-baileys': [
        { tag: 'v20260811040000000', pushed_at: '2026-08-11T04:00:00Z' },
      ],
      'under-worker-wwebjs': [
        { tag: 'v20260811030000000', pushed_at: '2026-08-11T03:00:00Z' },
      ],
      'under-worker-whatsmeow': [
        { tag: 'v20260811020000000', pushed_at: '2026-08-11T02:00:00Z' },
      ],
      'under-balance-api': [
        { tag: 'v20260811010000000', pushed_at: '2026-08-11T01:00:00Z' },
      ],
    };

    jest
      .spyOn(service, 'listRepositoryVersionTags')
      .mockImplementation(async (imageName) => tagsByImage[imageName] ?? []);

    const result = await service.listPairedBuildVersions(1);

    expect(result.map((item) => item.version)).toEqual([
      'v20260811040000000',
      'v20260811030000000',
      'v20260811020000000',
      'v20260811010000000',
    ]);
    expect(result[1]).toEqual({
      version: 'v20260811030000000',
      created_at: '2026-08-11T03:00:00Z',
      harbor_repositories: {
        [EServerBuildType.wwebjs]: 'underchat/balance/under-worker-wwebjs',
      },
      image_references: {
        [EServerBuildType.wwebjs]:
          'harbor.devunder.com/underchat/balance/under-worker-wwebjs:v20260811030000000',
      },
    });
  });

  it('groups equal tags while preserving only the repositories that contain them', async () => {
    const service = new ServerBuildHarborService();
    const sharedVersion = 'v20260811120000000';
    const tagsByImage: Record<string, IHarborArtifactTag[]> = {
      'under-worker-baileys': [
        { tag: sharedVersion, pushed_at: '2026-08-11T12:00:00Z' },
      ],
      'under-worker-wwebjs': [
        { tag: sharedVersion, pushed_at: '2026-08-11T12:01:00Z' },
      ],
      'under-worker-whatsmeow': [],
      'under-balance-api': [],
    };

    jest
      .spyOn(service, 'listRepositoryVersionTags')
      .mockImplementation(async (imageName) => tagsByImage[imageName] ?? []);

    await expect(service.listPairedBuildVersions(5)).resolves.toEqual([
      {
        version: sharedVersion,
        created_at: '2026-08-11T12:01:00Z',
        harbor_repositories: {
          [EServerBuildType.baileys]: 'underchat/balance/under-worker-baileys',
          [EServerBuildType.wwebjs]: 'underchat/balance/under-worker-wwebjs',
        },
        image_references: {
          [EServerBuildType.baileys]: `harbor.devunder.com/underchat/balance/under-worker-baileys:${sharedVersion}`,
          [EServerBuildType.wwebjs]: `harbor.devunder.com/underchat/balance/under-worker-wwebjs:${sharedVersion}`,
        },
      },
    ]);
  });
});
