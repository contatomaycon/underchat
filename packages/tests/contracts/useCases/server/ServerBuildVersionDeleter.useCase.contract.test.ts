import 'reflect-metadata';

jest.mock('@core/services/serverBuild.service', () => ({
  ServerBuildService: class {},
}));

jest.mock('@core/services/serverBuildHarbor.service', () => ({
  ServerBuildHarborService: class {},
}));

import { EServerBuildType } from '@core/common/enums/EServerBuildType';
import { ServerBuildVersionDeleterUseCase } from '@core/useCases/server/ServerBuildVersionDeleter.useCase';

describe('ServerBuildVersionDeleterUseCase', () => {
  const buildVersion = {
    server_build_version_id: 'version-1',
    build_type: EServerBuildType.baileys,
    version: 'v20260811170500000',
    harbor_registry: 'harbor.example',
    harbor_repository: 'underchat/under-worker-baileys',
    image_reference:
      'harbor.example/underchat/under-worker-baileys:v20260811170500000',
    is_default: false,
    created_at: '2026-08-11T17:05:00.000Z',
    updated_at: '2026-08-11T17:05:00.000Z',
  };

  const makeUseCase = () => {
    const serverBuildService = {
      getBuildVersionById: jest.fn(async () => buildVersion),
      hasActiveBuildJobForVersion: jest.fn(async () => false),
      hardDeleteBuildVersionById: jest.fn(async () => true),
    };
    const serverBuildHarborService = {
      deleteBuildVersionArtifact: jest.fn(async () => undefined),
    };

    return {
      useCase: new ServerBuildVersionDeleterUseCase(
        serverBuildService as never,
        serverBuildHarborService as never
      ),
      serverBuildService,
      serverBuildHarborService,
    };
  };

  const t = ((key: string) => key) as never;

  it('returns not found without touching Harbor when the version does not exist', async () => {
    const { useCase, serverBuildService, serverBuildHarborService } =
      makeUseCase();
    serverBuildService.getBuildVersionById.mockResolvedValueOnce(null as never);

    await expect(useCase.execute(t, 'missing')).resolves.toEqual({
      status: 'not_found',
    });
    expect(
      serverBuildHarborService.deleteBuildVersionArtifact
    ).not.toHaveBeenCalled();
  });

  it('blocks removal of the default version', async () => {
    const { useCase, serverBuildService, serverBuildHarborService } =
      makeUseCase();
    serverBuildService.getBuildVersionById.mockResolvedValueOnce({
      ...buildVersion,
      is_default: true,
    });

    await expect(useCase.execute(t, 'version-1')).resolves.toEqual({
      status: 'conflict_default',
    });
    expect(
      serverBuildHarborService.deleteBuildVersionArtifact
    ).not.toHaveBeenCalled();
  });

  it('blocks removal while a build with the same version is active', async () => {
    const { useCase, serverBuildService, serverBuildHarborService } =
      makeUseCase();
    serverBuildService.hasActiveBuildJobForVersion.mockResolvedValueOnce(true);

    await expect(useCase.execute(t, 'version-1')).resolves.toEqual({
      status: 'conflict_active',
    });
    expect(
      serverBuildHarborService.deleteBuildVersionArtifact
    ).not.toHaveBeenCalled();
  });

  it('removes only the selected worker artifact and version row', async () => {
    const { useCase, serverBuildService, serverBuildHarborService } =
      makeUseCase();

    await expect(useCase.execute(t, 'version-1')).resolves.toEqual({
      status: 'deleted',
      data: {
        server_build_version_id: 'version-1',
        build_type: EServerBuildType.baileys,
        version: 'v20260811170500000',
      },
    });
    expect(
      serverBuildHarborService.deleteBuildVersionArtifact
    ).toHaveBeenCalledWith(EServerBuildType.baileys, 'v20260811170500000');
    expect(serverBuildService.hardDeleteBuildVersionById).toHaveBeenCalledWith(
      'version-1'
    );
  });

  it('surfaces a localized error when Harbor removal fails', async () => {
    const { useCase, serverBuildHarborService } = makeUseCase();
    serverBuildHarborService.deleteBuildVersionArtifact.mockRejectedValueOnce(
      new Error('harbor unavailable')
    );

    await expect(useCase.execute(t, 'version-1')).rejects.toThrow(
      'server_build_version_delete_harbor_error'
    );
  });
});
