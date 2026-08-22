import 'reflect-metadata';

import { EWorkerImage } from '@core/common/enums/EWorkerImage';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { IChromiumLockCleanupAuthorizationRequestProto } from '@core/common/interfaces/IChromiumLockCleanupAuthorizationProto';
import { WorkerService } from '@core/services/worker.service';

const workerId = '019fa877-9f95-7518-9753-3f4e32569dee';
const accountId = '019a930d-c6f4-75ad-88ff-8d2fcd5839e1';
const serverId = '019d6978-3f4c-721f-a548-bdee707fed41';
const requesterContainerId =
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const requesterHostname = requesterContainerId.slice(0, 12);
const ownerContainerId =
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const ownerHostname = ownerContainerId.slice(0, 12);
const sessionVolumeName = 'warm-session-volume';
const runtimeGeneration = 7;
const requestId = '019faa5a-a64d-729d-8e63-7f16b625890e';
const lifecycleOperationId = '019faa5a-b732-74ab-a44f-bc929f6d255c';
const pinnedImageContentId = `sha256:${'c'.repeat(64)}`;

const request: IChromiumLockCleanupAuthorizationRequestProto = {
  request_id: requestId,
  worker_id: workerId,
  account_id: accountId,
  worker_type_id: EWorkerType.wwebjs,
  runtime_generation: runtimeGeneration,
  requester_container_id: requesterHostname,
  session_volume_name: sessionVolumeName,
  singleton_lock_target: `${ownerHostname}-26`,
};

const labels: Record<string, string> = {
  'underchat.worker_id': workerId,
  'underchat.account_id': accountId,
  'underchat.server_id': serverId,
  'underchat.worker_type_id': EWorkerType.wwebjs,
  'underchat.runtime_generation': String(runtimeGeneration),
  'underchat.session_volume_name': sessionVolumeName,
  'underchat.warm_standby': 'false',
  'underchat.worker_image': EWorkerImage.wwebjs,
};

const env = [
  `WORKER_ID=${workerId}`,
  `ACCOUNT_ID=${accountId}`,
  `WORKER_TYPE_ID=${EWorkerType.wwebjs}`,
  `RUNTIME_GENERATION=${runtimeGeneration}`,
  `SESSION_VOLUME_NAME=${sessionVolumeName}`,
  'WARM_STANDBY=false',
  `WORKER_IMAGE=${EWorkerImage.wwebjs}`,
];

function buildRequesterInspection(startedAt = '2026-07-28T17:00:00.000Z') {
  return {
    Id: requesterContainerId,
    Name: `/${workerId}`,
    RestartCount: 0,
    State: {
      Dead: false,
      Paused: false,
      Restarting: false,
      Running: true,
      StartedAt: startedAt,
      Status: 'running',
    },
    Config: {
      Env: [...env],
      Hostname: requesterHostname,
      Image: EWorkerImage.wwebjs as string,
      Labels: { ...labels },
    },
    Mounts: [
      {
        Destination: '/app/data',
        Name: sessionVolumeName,
        RW: true,
        Source: `/var/lib/docker/volumes/${sessionVolumeName}/_data`,
        Type: 'volume',
      },
    ],
  };
}

function buildContainerSummary(id: string, volumeName = sessionVolumeName) {
  return {
    Id: id,
    Mounts: [
      {
        Destination: '/app/data',
        Name: volumeName,
        RW: true,
        Type: 'volume',
      },
    ],
  };
}

interface AuthorizationHarness {
  service: WorkerService;
  listContainers: jest.Mock;
  ownerInspect: jest.Mock;
  requesterInspect: jest.Mock;
  viewRuntime: jest.Mock;
  viewWorker: jest.Mock;
}

function buildHarness(): AuthorizationHarness {
  const requesterInspect = jest
    .fn()
    .mockResolvedValue(buildRequesterInspection());
  const ownerNotFound = Object.assign(new Error('No such container'), {
    statusCode: 404,
  });
  const ownerInspect = jest.fn().mockRejectedValue(ownerNotFound);
  const listContainers = jest
    .fn()
    .mockResolvedValue([buildContainerSummary(requesterContainerId)]);
  const viewWorker = jest.fn().mockResolvedValue({
    worker_id: workerId,
    account_id: accountId,
    server_id: serverId,
    worker_status_id: EWorkerStatus.online,
    worker_type_id: EWorkerType.wwebjs,
    container_id: requesterContainerId,
    lifecycle_operation_id: null,
    deleted_at: null,
  });
  const viewRuntime = jest.fn().mockResolvedValue({
    worker_id: workerId,
    container_id: requesterContainerId,
    session_volume_name: sessionVolumeName,
    runtime_generation: runtimeGeneration,
  });
  const docker = {
    getContainer: jest.fn((containerId: string) => ({
      inspect:
        containerId === requesterHostname ? requesterInspect : ownerInspect,
    })),
    listContainers,
  };
  const service = Object.create(WorkerService.prototype) as WorkerService;

  Object.defineProperties(service, {
    docker: { configurable: true, value: docker },
    inspectedEnvKeys: {
      configurable: true,
      value: new Set([
        ...env.map((entry) => entry.slice(0, entry.indexOf('='))),
        'WARM_POOL_ID',
      ]),
    },
    inspectedLabelKeys: {
      configurable: true,
      value: new Set([...Object.keys(labels), 'underchat.warm_pool_id']),
    },
    workerMonitorViewerRepository: {
      configurable: true,
      value: { viewWorkerConsistent: viewWorker },
    },
    workerRuntimeRepository: {
      configurable: true,
      value: { viewByWorkerIdConsistent: viewRuntime },
    },
  });

  return {
    service,
    listContainers,
    ownerInspect,
    requesterInspect,
    viewRuntime,
    viewWorker,
  };
}

describe('WorkerService Chromium lock cleanup authorization', () => {
  const previousServerId = process.env.SERVER_ID;

  beforeAll(() => {
    process.env.SERVER_ID = serverId;
  });

  afterAll(() => {
    if (previousServerId === undefined) {
      delete process.env.SERVER_ID;
      return;
    }
    process.env.SERVER_ID = previousServerId;
  });

  it('authorizes only an absent foreign owner with one stable volume mount', async () => {
    const harness = buildHarness();
    jest.spyOn(Date, 'now').mockReturnValue(1_785_249_000_000);

    await expect(
      harness.service.authorizeChromiumLockCleanup(request)
    ).resolves.toEqual({
      authorized: true,
      reason: 'authorized',
      request_id: requestId,
      requester_container_id: requesterHostname,
      owner_container_id: ownerHostname,
      session_volume_name: sessionVolumeName,
      singleton_lock_target: `${ownerHostname}-26`,
      expires_at_unix_ms: 1_785_249_001_500,
    });

    expect(harness.requesterInspect).toHaveBeenCalledTimes(2);
    expect(harness.ownerInspect).toHaveBeenCalledTimes(2);
    expect(harness.listContainers).toHaveBeenCalledTimes(2);
    expect(harness.viewWorker).toHaveBeenCalledTimes(2);
    expect(harness.viewRuntime).toHaveBeenCalledTimes(2);
  });

  it('authorizes a content-pinned WWebJS requester with coherent Docker image ID', async () => {
    const harness = buildHarness();
    const inspection = {
      ...buildRequesterInspection(),
      Image: pinnedImageContentId,
    };
    inspection.Config.Image = pinnedImageContentId;
    harness.requesterInspect.mockResolvedValue(inspection);

    await expect(
      harness.service.authorizeChromiumLockCleanup(request)
    ).resolves.toMatchObject({
      authorized: true,
      reason: 'authorized',
    });
  });

  it('rejects a content-pinned requester when Config.Image and Docker Image diverge', async () => {
    const harness = buildHarness();
    const inspection = {
      ...buildRequesterInspection(),
      Image: `sha256:${'d'.repeat(64)}`,
    };
    inspection.Config.Image = pinnedImageContentId;
    harness.requesterInspect.mockResolvedValue(inspection);

    await expect(
      harness.service.authorizeChromiumLockCleanup(request)
    ).resolves.toMatchObject({
      authorized: false,
      reason: 'requester_identity_mismatch',
    });
  });

  it('authorizes the newly anchored runtime during a fenced recreate transition', async () => {
    const harness = buildHarness();
    const inspection = buildRequesterInspection();
    inspection.Config.Labels['underchat.lifecycle_operation_id'] =
      lifecycleOperationId;
    harness.requesterInspect.mockResolvedValue(inspection);
    harness.viewWorker.mockResolvedValue({
      worker_id: workerId,
      account_id: accountId,
      server_id: serverId,
      worker_status_id: EWorkerStatus.recreating,
      worker_type_id: EWorkerType.wwebjs,
      container_id: ownerContainerId,
      lifecycle_operation_id: lifecycleOperationId,
      deleted_at: null,
    });

    await expect(
      harness.service.authorizeChromiumLockCleanup(request)
    ).resolves.toMatchObject({
      authorized: true,
      reason: 'authorized',
    });
  });

  it('authorizes a newly anchored create runtime with an empty legacy pointer', async () => {
    const harness = buildHarness();
    const inspection = buildRequesterInspection();
    inspection.Config.Labels['underchat.lifecycle_operation_id'] =
      lifecycleOperationId;
    harness.requesterInspect.mockResolvedValue(inspection);
    harness.viewWorker.mockResolvedValue({
      worker_id: workerId,
      account_id: accountId,
      server_id: serverId,
      worker_status_id: EWorkerStatus.creating,
      worker_type_id: EWorkerType.wwebjs,
      container_id: null,
      lifecycle_operation_id: lifecycleOperationId,
      deleted_at: null,
    });

    await expect(
      harness.service.authorizeChromiumLockCleanup(request)
    ).resolves.toMatchObject({
      authorized: true,
      reason: 'authorized',
    });
  });

  it('rejects a transition container created by a different lifecycle', async () => {
    const harness = buildHarness();
    const inspection = buildRequesterInspection();
    inspection.Config.Labels['underchat.lifecycle_operation_id'] =
      '019faa5a-c841-736d-bb51-cda3a07e366d';
    harness.requesterInspect.mockResolvedValue(inspection);
    harness.viewWorker.mockResolvedValue({
      worker_id: workerId,
      account_id: accountId,
      server_id: serverId,
      worker_status_id: EWorkerStatus.recreating,
      worker_type_id: EWorkerType.wwebjs,
      container_id: ownerContainerId,
      lifecycle_operation_id: lifecycleOperationId,
      deleted_at: null,
    });

    await expect(
      harness.service.authorizeChromiumLockCleanup(request)
    ).resolves.toMatchObject({
      authorized: false,
      reason: 'requester_identity_mismatch',
    });
  });

  it('rejects a lagging worker pointer without a fenced recreate lifecycle', async () => {
    const harness = buildHarness();
    harness.viewWorker.mockResolvedValue({
      worker_id: workerId,
      account_id: accountId,
      server_id: serverId,
      worker_status_id: EWorkerStatus.recreating,
      worker_type_id: EWorkerType.wwebjs,
      container_id: ownerContainerId,
      lifecycle_operation_id: null,
      deleted_at: null,
    });

    await expect(
      harness.service.authorizeChromiumLockCleanup(request)
    ).resolves.toMatchObject({
      authorized: false,
      reason: 'runtime_identity_mismatch',
    });
    expect(harness.listContainers).not.toHaveBeenCalled();
  });

  it('rejects a recreate pointer that does not own the stale lock', async () => {
    const harness = buildHarness();
    harness.viewWorker.mockResolvedValue({
      worker_id: workerId,
      account_id: accountId,
      server_id: serverId,
      worker_status_id: EWorkerStatus.recreating,
      worker_type_id: EWorkerType.wwebjs,
      container_id:
        'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      lifecycle_operation_id: lifecycleOperationId,
      deleted_at: null,
    });

    await expect(
      harness.service.authorizeChromiumLockCleanup(request)
    ).resolves.toMatchObject({
      authorized: false,
      reason: 'runtime_identity_mismatch',
    });
    expect(harness.listContainers).not.toHaveBeenCalled();
  });

  it('rejects a forbidden worker status even with a lifecycle fence', async () => {
    const harness = buildHarness();
    harness.viewWorker.mockResolvedValue({
      worker_id: workerId,
      account_id: accountId,
      server_id: serverId,
      worker_status_id: EWorkerStatus.deleting,
      worker_type_id: EWorkerType.wwebjs,
      container_id: ownerContainerId,
      lifecycle_operation_id: lifecycleOperationId,
      deleted_at: null,
    });

    await expect(
      harness.service.authorizeChromiumLockCleanup(request)
    ).resolves.toMatchObject({
      authorized: false,
      reason: 'runtime_identity_mismatch',
    });
    expect(harness.listContainers).not.toHaveBeenCalled();
  });

  it('accepts a legacy regular runtime with no warm metadata', async () => {
    const harness = buildHarness();
    const inspection = buildRequesterInspection();
    delete inspection.Config.Labels['underchat.warm_standby'];
    inspection.Config.Env = inspection.Config.Env.filter(
      (entry) => !entry.startsWith('WARM_')
    );
    harness.requesterInspect.mockResolvedValue(inspection);

    await expect(
      harness.service.authorizeChromiumLockCleanup(request)
    ).resolves.toMatchObject({
      authorized: true,
      reason: 'authorized',
    });
  });

  it('accepts an activated warm runtime with coherent metadata', async () => {
    const harness = buildHarness();
    const warmPoolId = '019faa5a-a63c-7478-b5d6-bb6663199908';
    const inspection = buildRequesterInspection();
    inspection.Config.Labels['underchat.warm_pool_id'] = warmPoolId;
    inspection.Config.Env.push(`WARM_POOL_ID=${warmPoolId}`);
    harness.requesterInspect.mockResolvedValue(inspection);
    harness.viewRuntime.mockResolvedValue({
      worker_id: workerId,
      container_id: requesterContainerId,
      session_volume_name: sessionVolumeName,
      runtime_generation: runtimeGeneration,
      warm_pool_id: warmPoolId,
    });

    await expect(
      harness.service.authorizeChromiumLockCleanup(request)
    ).resolves.toMatchObject({
      authorized: true,
      reason: 'authorized',
    });
  });

  it('rejects partial warm metadata even with a durable warm id', async () => {
    const harness = buildHarness();
    const warmPoolId = '019faa5a-a63c-7478-b5d6-bb6663199908';
    const inspection = buildRequesterInspection();
    inspection.Config.Labels['underchat.warm_pool_id'] = warmPoolId;
    harness.requesterInspect.mockResolvedValue(inspection);
    harness.viewRuntime.mockResolvedValue({
      worker_id: workerId,
      container_id: requesterContainerId,
      session_volume_name: sessionVolumeName,
      runtime_generation: runtimeGeneration,
      warm_pool_id: warmPoolId,
    });

    await expect(
      harness.service.authorizeChromiumLockCleanup(request)
    ).resolves.toMatchObject({
      authorized: false,
      reason: 'requester_identity_mismatch',
    });
  });

  it('accepts an activated warm runtime whose legacy container has no warm metadata', async () => {
    const harness = buildHarness();
    const inspection = buildRequesterInspection();
    delete (inspection.Config.Labels as Record<string, string>)[
      'underchat.warm_standby'
    ];
    inspection.Config.Env = inspection.Config.Env.filter(
      (entry) => !entry.startsWith('WARM_STANDBY=')
    );
    harness.requesterInspect.mockResolvedValue(inspection);
    harness.viewRuntime.mockResolvedValue({
      worker_id: workerId,
      container_id: requesterContainerId,
      session_volume_name: sessionVolumeName,
      runtime_generation: runtimeGeneration,
      warm_pool_id: '019faa5a-a63c-7478-b5d6-bb6663199908',
    });

    await expect(
      harness.service.authorizeChromiumLockCleanup(request)
    ).resolves.toMatchObject({
      authorized: true,
      reason: 'authorized',
    });
  });

  it('fails closed when Docker is unavailable', async () => {
    const harness = buildHarness();
    harness.listContainers.mockRejectedValue(
      Object.assign(new Error('Docker daemon unavailable'), {
        statusCode: 503,
      })
    );

    await expect(
      harness.service.authorizeChromiumLockCleanup(request)
    ).resolves.toMatchObject({
      authorized: false,
      reason: 'docker_unavailable',
    });
  });

  it('does not infer owner absence from an untyped error message', async () => {
    const harness = buildHarness();
    harness.ownerInspect.mockRejectedValue(new Error('No such container'));

    await expect(
      harness.service.authorizeChromiumLockCleanup(request)
    ).resolves.toMatchObject({
      authorized: false,
      reason: 'docker_unavailable',
    });
  });

  it.each([
    ['running', true],
    ['exited', false],
    ['restarting', true],
  ])('rejects a %s owner container', async (status, running) => {
    const harness = buildHarness();
    harness.ownerInspect.mockResolvedValue({
      Id: ownerContainerId,
      State: { Running: running, Status: status },
    });

    await expect(
      harness.service.authorizeChromiumLockCleanup(request)
    ).resolves.toMatchObject({
      authorized: false,
      reason: 'lock_owner_present',
    });
  });

  it('rejects any second container mounting the session volume', async () => {
    const harness = buildHarness();
    harness.listContainers.mockResolvedValue([
      buildContainerSummary(requesterContainerId),
      buildContainerSummary(ownerContainerId),
    ]);

    await expect(
      harness.service.authorizeChromiumLockCleanup(request)
    ).resolves.toMatchObject({
      authorized: false,
      reason: 'volume_shared',
    });
  });

  it('rejects a Docker snapshot that changes during authorization', async () => {
    const harness = buildHarness();
    harness.requesterInspect
      .mockResolvedValueOnce(
        buildRequesterInspection('2026-07-28T17:00:00.000Z')
      )
      .mockResolvedValueOnce(
        buildRequesterInspection('2026-07-28T17:00:01.000Z')
      );

    await expect(
      harness.service.authorizeChromiumLockCleanup(request)
    ).resolves.toMatchObject({
      authorized: false,
      reason: 'docker_snapshot_changed',
    });
  });

  it('rejects a control-plane snapshot that changes after Docker checks', async () => {
    const harness = buildHarness();
    harness.viewRuntime
      .mockResolvedValueOnce({
        worker_id: workerId,
        container_id: requesterContainerId,
        session_volume_name: sessionVolumeName,
        runtime_generation: runtimeGeneration,
      })
      .mockResolvedValueOnce({
        worker_id: workerId,
        container_id: requesterContainerId,
        session_volume_name: sessionVolumeName,
        runtime_generation: runtimeGeneration + 1,
      });

    await expect(
      harness.service.authorizeChromiumLockCleanup(request)
    ).resolves.toMatchObject({
      authorized: false,
      reason: 'runtime_identity_mismatch',
    });
  });

  it('rejects authorization when recreate finalizes between control-plane snapshots', async () => {
    const harness = buildHarness();
    const inspection = buildRequesterInspection();
    inspection.Config.Labels['underchat.lifecycle_operation_id'] =
      lifecycleOperationId;
    harness.requesterInspect.mockResolvedValue(inspection);
    harness.viewWorker
      .mockResolvedValueOnce({
        worker_id: workerId,
        account_id: accountId,
        server_id: serverId,
        worker_status_id: EWorkerStatus.recreating,
        worker_type_id: EWorkerType.wwebjs,
        container_id: ownerContainerId,
        lifecycle_operation_id: lifecycleOperationId,
        deleted_at: null,
      })
      .mockResolvedValueOnce({
        worker_id: workerId,
        account_id: accountId,
        server_id: serverId,
        worker_status_id: EWorkerStatus.online,
        worker_type_id: EWorkerType.wwebjs,
        container_id: requesterContainerId,
        lifecycle_operation_id: null,
        deleted_at: null,
      });

    await expect(
      harness.service.authorizeChromiumLockCleanup(request)
    ).resolves.toMatchObject({
      authorized: false,
      reason: 'runtime_identity_mismatch',
    });
  });

  it('rejects malformed, cross-provider and unfenced requests before Docker', async () => {
    const harness = buildHarness();

    for (const invalidRequest of [
      { ...request, singleton_lock_target: '../../container-26' },
      { ...request, worker_type_id: EWorkerType.baileys },
      { ...request, runtime_generation: 0 },
    ]) {
      await expect(
        harness.service.authorizeChromiumLockCleanup(invalidRequest)
      ).resolves.toMatchObject({
        authorized: false,
        reason: 'invalid_request',
      });
    }

    expect(harness.listContainers).not.toHaveBeenCalled();
    expect(harness.requesterInspect).not.toHaveBeenCalled();
    expect(harness.ownerInspect).not.toHaveBeenCalled();
  });
});
