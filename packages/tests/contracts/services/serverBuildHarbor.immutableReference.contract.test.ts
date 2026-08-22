import 'reflect-metadata';

const axiosGet = jest.fn();
const axiosDelete = jest.fn();

jest.mock('axios', () => ({
  __esModule: true,
  AxiosError: class AxiosError extends Error {},
  default: {
    create: () => ({
      delete: axiosDelete,
      get: axiosGet,
    }),
  },
}));

import { EServerBuildType } from '@core/common/enums/EServerBuildType';
import { ServerBuildHarborService } from '@core/services/serverBuildHarbor.service';

const DIGEST = `sha256:${'b'.repeat(64)}`;
const REPOSITORY = 'harbor.example/underchat/balance/under-balance-api';

describe('ServerBuildHarborService immutable image reference contract', () => {
  const originalEnvironment = {
    namespace: process.env.HARBOR_NAMESPACE,
    password: process.env.HARBOR_PASSWORD,
    registry: process.env.HARBOR_REGISTRY,
    username: process.env.HARBOR_USERNAME,
  };

  beforeEach(() => {
    process.env.HARBOR_REGISTRY = 'harbor.example';
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

  it('resolves a mutable build tag once through Harbor', async () => {
    axiosGet.mockResolvedValueOnce({ data: { digest: DIGEST } });
    const service = new ServerBuildHarborService();

    await expect(
      service.resolveImmutableImageReference(
        EServerBuildType.balance_api,
        `${REPOSITORY}:v20260730010101000`
      )
    ).resolves.toEqual({
      digest: DIGEST,
      imageReference: `${REPOSITORY}@${DIGEST}`,
    });
    expect(axiosGet).toHaveBeenCalledWith(
      '/projects/underchat/repositories/balance%2Funder-balance-api/artifacts/v20260730010101000',
      expect.objectContaining({
        params: expect.objectContaining({ with_immutable_status: true }),
      })
    );
  });

  it('accepts an already immutable configured reference without a registry lookup', async () => {
    const service = new ServerBuildHarborService();

    await expect(
      service.resolveImmutableImageReference(
        EServerBuildType.balance_api,
        `${REPOSITORY}@${DIGEST}`
      )
    ).resolves.toEqual({
      digest: DIGEST,
      imageReference: `${REPOSITORY}@${DIGEST}`,
    });
    expect(axiosGet).not.toHaveBeenCalled();
  });

  it('fails closed for a foreign repository or malformed Harbor digest', async () => {
    const service = new ServerBuildHarborService();

    await expect(
      service.resolveImmutableImageReference(
        EServerBuildType.balance_api,
        `evil.example/under-balance-api@${DIGEST}`
      )
    ).rejects.toThrow('does not belong');

    axiosGet.mockResolvedValueOnce({ data: { digest: 'sha256:not-a-digest' } });
    await expect(
      service.resolveImmutableImageReference(
        EServerBuildType.balance_api,
        `${REPOSITORY}:v123`
      )
    ).rejects.toThrow('invalid balance_api image digest');
  });

  it('deletes only the artifact for the selected build type', async () => {
    axiosDelete.mockResolvedValueOnce({ data: null });
    const service = new ServerBuildHarborService();

    await expect(
      service.deleteBuildVersionArtifact(
        EServerBuildType.baileys,
        'v20260811170500000'
      )
    ).resolves.toBeUndefined();
    expect(axiosDelete).toHaveBeenCalledWith(
      '/projects/underchat/repositories/balance%2Funder-worker-baileys/artifacts/v20260811170500000'
    );
  });
});
