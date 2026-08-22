import 'reflect-metadata';

jest.mock('@core/repositories/server/ServerBuild.repository', () => ({
  ServerBuildRepository: class {},
}));

import { ServerBuildService } from '@core/services/serverBuild.service';
import { EServerBuildType } from '@core/common/enums/EServerBuildType';

describe('ServerBuildService', () => {
  const makeService = () => {
    const serverBuildRepository = {
      listBuilds: jest.fn(async () => ({ jobs: [] })),
      createBuildJob: jest.fn(async () => ({ server_build_job_id: 'job-1' })),
      getBuildJobById: jest.fn(async () => ({ server_build_job_id: 'job-1' })),
      requestCancelForActiveJob: jest.fn(async () => ({ canceled: true })),
      rollbackCancelRequest: jest.fn(async () => undefined),
      markJobRunning: jest.fn(async () => true),
      claimJobItemForExecution: jest.fn(async () => 'item-1'),
      isCancelRequested: jest.fn(async () => true),
      cancelJobIfNotRunning: jest.fn(async () => undefined),
      markJobItemRunning: jest.fn(async () => undefined),
      touchRunningJobItem: jest.fn(async () => undefined),
      failStaleRunningItems: jest.fn(async () => ['job-1']),
      markJobItemFailed: jest.fn(async () => undefined),
      markJobItemCanceled: jest.fn(async () => undefined),
      markJobItemSuccessAndPersistVersion: jest.fn(async () => undefined),
      retryFailedJobItem: jest.fn(async () => 'item-2'),
      syncJobStatusFromItems: jest.fn(async () => 'completed'),
      markJobFailed: jest.fn(async () => undefined),
      markJobCompleted: jest.fn(async () => undefined),
      markJobCanceled: jest.fn(async () => undefined),
      hasActiveBuildJob: jest.fn(async () => false),
      setDefaultVersion: jest.fn(async () => ({ ok: true })),
      getBuildJobSummaryById: jest.fn(async () => ({
        server_build_job_id: 'job-1',
        version: 'v20260101000000000',
        status: 'completed',
      })),
      getBuildVersionById: jest.fn(async () => ({
        server_build_version_id: 'ver-1',
      })),
      hasActiveBuildJobForVersion: jest.fn(async () => false),
      hardDeleteBuildVersionById: jest.fn(async () => true),
      isBuildVersionDefault: jest.fn(async () => true),
      hardDeleteBuildByVersion: jest.fn(async () => ({ deleted: true })),
      pairBuildVersionFromHarbor: jest.fn(async () => ({
        imported: true,
        created_jobs: 1,
        created_versions: 1,
      })),
      getDefaultImages: jest.fn(async () => ({ default_image: 'img:1' })),
    };

    const service = new ServerBuildService(serverBuildRepository as never);

    return {
      service,
      serverBuildRepository,
    };
  };

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('delegates all repository operations and creates version string when creating job', async () => {
    const { service, serverBuildRepository } = makeService();

    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-02T03:04:05.678Z'));

    await expect(service.listBuilds()).resolves.toEqual({ jobs: [] });

    await expect(
      service.createBuildJob('user-1', [EServerBuildType.baileys])
    ).resolves.toEqual({
      server_build_job_id: 'job-1',
    });
    expect(serverBuildRepository.createBuildJob).toHaveBeenCalledWith(
      'user-1',
      'v20260102030405678',
      [EServerBuildType.baileys],
      false
    );

    await expect(
      service.createBuildJob(
        'user-1',
        [EServerBuildType.balance_api],
        'v20260101000000000'
      )
    ).resolves.toEqual({
      server_build_job_id: 'job-1',
    });
    expect(serverBuildRepository.createBuildJob).toHaveBeenLastCalledWith(
      'user-1',
      'v20260101000000000',
      [EServerBuildType.balance_api],
      true
    );

    await expect(service.getBuildJobById('job-1')).resolves.toEqual({
      server_build_job_id: 'job-1',
    });
    await expect(service.requestCancelForActiveJob()).resolves.toEqual({
      canceled: true,
    });
    await expect(
      service.rollbackCancelRequest('job-1', 'running' as never)
    ).resolves.toBeUndefined();
    await expect(service.markJobRunning('job-1')).resolves.toBe(true);
    await expect(
      service.claimJobItemForExecution('job-1', 'baileys' as never)
    ).resolves.toBe('item-1');
    await expect(service.isCancelRequested('job-1')).resolves.toBe(true);
    await expect(
      service.cancelJobIfNotRunning('job-1')
    ).resolves.toBeUndefined();
    await expect(
      service.markJobItemRunning('job-1', 'baileys' as never)
    ).resolves.toBeUndefined();
    await expect(
      service.touchRunningJobItem('job-1', 'baileys' as never)
    ).resolves.toBeUndefined();
    await expect(service.failStaleRunningItems(1000, 'stale')).resolves.toEqual(
      ['job-1']
    );
    await expect(
      service.markJobItemFailed('job-1', 'baileys' as never, 'err')
    ).resolves.toBeUndefined();
    await expect(
      service.markJobItemCanceled('job-1', 'baileys' as never)
    ).resolves.toBeUndefined();
    expect(serverBuildRepository.markJobItemCanceled).toHaveBeenCalledWith(
      'job-1',
      'baileys',
      null
    );

    await expect(
      service.markJobItemSuccessAndPersistVersion({
        server_build_job_id: 'job-1',
      } as never)
    ).resolves.toBeUndefined();
    await expect(
      service.retryFailedJobItem('job-1', 'baileys' as never)
    ).resolves.toBe('item-2');
    await expect(service.syncJobStatusFromItems('job-1')).resolves.toBe(
      'completed'
    );
    await expect(
      service.markJobFailed('job-1', 'err')
    ).resolves.toBeUndefined();
    await expect(service.markJobCompleted('job-1')).resolves.toBeUndefined();
    await expect(service.markJobCanceled('job-1')).resolves.toBeUndefined();
    expect(serverBuildRepository.markJobCanceled).toHaveBeenCalledWith(
      'job-1',
      null
    );

    await expect(service.hasActiveBuildJob()).resolves.toBe(false);
    await expect(service.setDefaultVersion('ver-1')).resolves.toEqual({
      ok: true,
    });
    await expect(service.getBuildJobSummaryById('job-1')).resolves.toEqual({
      server_build_job_id: 'job-1',
      version: 'v20260101000000000',
      status: 'completed',
    });
    await expect(service.getBuildVersionById('ver-1')).resolves.toEqual({
      server_build_version_id: 'ver-1',
    });
    await expect(service.hasActiveBuildJobForVersion('v1')).resolves.toBe(
      false
    );
    await expect(service.hardDeleteBuildVersionById('ver-1')).resolves.toBe(
      true
    );
    await expect(service.isBuildVersionDefault('v1')).resolves.toBe(true);
    await expect(service.hardDeleteBuildByVersion('v1')).resolves.toEqual({
      deleted: true,
    });
    await expect(
      service.pairBuildVersionFromHarbor({ type: 'baileys' } as never)
    ).resolves.toEqual({
      imported: true,
      created_jobs: 1,
      created_versions: 1,
    });
    await expect(service.getDefaultImages()).resolves.toEqual({
      default_image: 'img:1',
    });
  });

  it('passes explicit error message when canceling job/item', async () => {
    const { service, serverBuildRepository } = makeService();

    await expect(
      service.markJobItemCanceled('job-1', 'wwebjs' as never, 'manual cancel')
    ).resolves.toBeUndefined();
    await expect(
      service.markJobCanceled('job-1', 'manual cancel')
    ).resolves.toBeUndefined();

    expect(serverBuildRepository.markJobItemCanceled).toHaveBeenCalledWith(
      'job-1',
      'wwebjs',
      'manual cancel'
    );
    expect(serverBuildRepository.markJobCanceled).toHaveBeenCalledWith(
      'job-1',
      'manual cancel'
    );
  });
});
