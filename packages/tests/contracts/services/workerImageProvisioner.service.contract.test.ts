import 'reflect-metadata';

import { EWorkerImage } from '@core/common/enums/EWorkerImage';
import { IServerBuildDefaultImages } from '@core/common/interfaces/IServerBuildDefaultImages';
import { buildEnvironment } from '@core/config/environments';
import {
  WorkerImageProvisionResult,
  WorkerImageProvisionerService,
} from '@core/services/workerImageProvisioner.service';

const HARBOR_REGISTRY = 'registry.test.example';
const HARBOR_NAMESPACE = 'underchat/balance';
const HARBOR_USERNAME = 'registry-user';
const HARBOR_PASSWORD = 'registry-password-must-not-leak';
const BAILEYS_REPOSITORY = `${HARBOR_REGISTRY}/${HARBOR_NAMESPACE}/under-worker-baileys`;
const BAILEYS_V1 = `${BAILEYS_REPOSITORY}:v1`;
const BAILEYS_V2 = `${BAILEYS_REPOSITORY}:v2`;
const WWEBJS_V1 = `${HARBOR_REGISTRY}/${HARBOR_NAMESPACE}/under-worker-wwebjs:v1`;
const IMAGE_ID_OLD = `sha256:${'0'.repeat(64)}`;
const IMAGE_ID_V1 = `sha256:${'1'.repeat(64)}`;
const IMAGE_ID_V2 = `sha256:${'2'.repeat(64)}`;
const IMAGE_ID_WWEBJS = `sha256:${'3'.repeat(64)}`;

interface DockerHarness {
  readonly images: Map<string, string>;
  readonly getImage: jest.Mock;
  readonly pull: jest.Mock;
  readonly tag: jest.Mock;
  readonly followProgress: jest.Mock;
  pullContentId: string;
  pullError: Error | null;
  shouldRetag: boolean;
}

interface ProvisionerHarness {
  ensureImage: (
    alias: EWorkerImage,
    options?: { readonly abortSignal?: AbortSignal }
  ) => Promise<WorkerImageProvisionResult>;
}

function buildDefaults(
  baileysReference: string = BAILEYS_V1
): IServerBuildDefaultImages {
  return {
    baileys: baileysReference,
    wwebjs: `${HARBOR_REGISTRY}/${HARBOR_NAMESPACE}/under-worker-wwebjs:v1`,
    whatsmeow: `${HARBOR_REGISTRY}/${HARBOR_NAMESPACE}/under-worker-whatsmeow:v1`,
    balance_api: `${HARBOR_REGISTRY}/${HARBOR_NAMESPACE}/under-balance-api:v1`,
  };
}

function buildDockerHarness(
  initialImages: Readonly<Record<string, string>>
): DockerHarness {
  const images = new Map(Object.entries(initialImages));
  const tag = jest.fn(async function (
    this: { reference: string },
    input: { repo: string; tag: string }
  ): Promise<void> {
    if (!harness.shouldRetag) {
      return;
    }

    const contentId = images.get(this.reference);
    if (!contentId) {
      throw Object.assign(new Error('No such image'), { statusCode: 404 });
    }
    images.set(`${input.repo}:${input.tag}`, contentId);
  });
  const getImage = jest.fn((reference: string) => ({
    inspect: jest.fn(async () => {
      const contentId = images.get(reference);
      if (!contentId) {
        throw Object.assign(new Error('No such image'), { statusCode: 404 });
      }
      return { Id: contentId };
    }),
    tag: tag.bind({ reference }),
  }));
  const pull = jest.fn(async (reference: string) => ({ reference }));
  const followProgress = jest.fn(
    (
      stream: { reference: string },
      callback: (error: Error | null) => void
    ): void => {
      if (harness.pullError) {
        callback(harness.pullError);
        return;
      }
      images.set(stream.reference, harness.pullContentId);
      callback(null);
    }
  );
  const harness: DockerHarness = {
    images,
    getImage,
    pull,
    tag,
    followProgress,
    pullContentId: IMAGE_ID_V1,
    pullError: null,
    shouldRetag: true,
  };

  return harness;
}

function buildProvisioner(input: {
  readonly getDefaultImages: jest.Mock;
  readonly docker: DockerHarness;
}): ProvisionerHarness {
  const service = new WorkerImageProvisionerService({
    getDefaultImages: input.getDefaultImages,
  } as never) as unknown as ProvisionerHarness;
  Object.defineProperty(service, 'docker', {
    configurable: true,
    value: {
      getImage: input.docker.getImage,
      pull: input.docker.pull,
      modem: {
        followProgress: input.docker.followProgress,
      },
    },
  });

  return service;
}

const ENVIRONMENT_KEYS = [
  'APP_ENVIRONMENT',
  'HARBOR_REGISTRY',
  'HARBOR_NAMESPACE',
  'HARBOR_USERNAME',
  'HARBOR_PASSWORD',
  'WORKER_IMAGE_PROVISION_TIMEOUT_MS',
  'WORKER_IMAGE_DEFAULT_CACHE_TTL_MS',
  'WORKER_IMAGE_BAILEYS_REFERENCE',
] as const;

describe('WorkerImageProvisionerService contract', () => {
  const originalEnvironment = new Map(
    ENVIRONMENT_KEYS.map((key) => [key, process.env[key]])
  );

  beforeEach(() => {
    process.env.APP_ENVIRONMENT = 'PROD';
    process.env.HARBOR_REGISTRY = HARBOR_REGISTRY;
    process.env.HARBOR_NAMESPACE = HARBOR_NAMESPACE;
    process.env.HARBOR_USERNAME = HARBOR_USERNAME;
    process.env.HARBOR_PASSWORD = HARBOR_PASSWORD;
    process.env.WORKER_IMAGE_PROVISION_TIMEOUT_MS = '10000';
    process.env.WORKER_IMAGE_DEFAULT_CACHE_TTL_MS = '100';
    delete process.env.WORKER_IMAGE_BAILEYS_REFERENCE;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    for (const [key, value] of originalEnvironment) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('uses a five-minute default for large sequential image pulls', () => {
    delete process.env.WORKER_IMAGE_PROVISION_TIMEOUT_MS;

    expect(buildEnvironment.workerImageProvisionTimeoutMs).toBe(300_000);
  });

  it('uses the verified local cache without pulling or retagging', async () => {
    const docker = buildDockerHarness({
      [BAILEYS_V1]: IMAGE_ID_V1,
      [EWorkerImage.baileys]: IMAGE_ID_V1,
    });
    const getDefaultImages = jest.fn(async () => buildDefaults());
    const service = buildProvisioner({ getDefaultImages, docker });

    await expect(service.ensureImage(EWorkerImage.baileys)).resolves.toEqual({
      alias: EWorkerImage.baileys,
      contentId: IMAGE_ID_V1,
      desiredReference: BAILEYS_V1,
    });
    expect(docker.pull).not.toHaveBeenCalled();
    expect(docker.tag).not.toHaveBeenCalled();
  });

  it('pulls from Harbor with authentication and atomically verifies the alias', async () => {
    const docker = buildDockerHarness({
      [EWorkerImage.baileys]: IMAGE_ID_OLD,
    });
    const service = buildProvisioner({
      getDefaultImages: jest.fn(async () => buildDefaults()),
      docker,
    });

    await expect(service.ensureImage(EWorkerImage.baileys)).resolves.toEqual(
      expect.objectContaining({
        contentId: IMAGE_ID_V1,
      })
    );
    expect(docker.pull).toHaveBeenCalledWith(
      BAILEYS_V1,
      expect.objectContaining({
        authconfig: {
          username: HARBOR_USERNAME,
          password: HARBOR_PASSWORD,
          serveraddress: HARBOR_REGISTRY,
        },
      })
    );
    expect(docker.images.get(EWorkerImage.baileys)).toBe(IMAGE_ID_V1);
  });

  it('serializes concurrent provisioning and reuses the first successful pull', async () => {
    const docker = buildDockerHarness({
      [EWorkerImage.baileys]: IMAGE_ID_OLD,
    });
    const getDefaultImages = jest.fn(async () => buildDefaults());
    const firstPullStarted = new Promise<void>((resolve) => {
      docker.pull.mockImplementationOnce(async (reference: string) => {
        resolve();
        await new Promise<void>((release) => setImmediate(release));
        return { reference };
      });
    });
    const service = buildProvisioner({ getDefaultImages, docker });

    const first = service.ensureImage(EWorkerImage.baileys);
    await firstPullStarted;
    const second = service.ensureImage(EWorkerImage.baileys);
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult.contentId).toBe(IMAGE_ID_V1);
    expect(secondResult.contentId).toBe(IMAGE_ID_V1);
    expect(docker.pull).toHaveBeenCalledTimes(1);
    expect(docker.tag).toHaveBeenCalledTimes(1);
  });

  it('does not let a later caller bypass an aborted queued waiter', async () => {
    const docker = buildDockerHarness({});
    const service = buildProvisioner({
      getDefaultImages: jest.fn(),
      docker,
    });
    let activeOperations = 0;
    let maximumConcurrency = 0;
    let releaseFirst: () => void = () => undefined;
    let markFirstStarted: () => void = () => undefined;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let invocation = 0;
    Object.defineProperty(service, 'ensureImageLocked', {
      configurable: true,
      value: jest.fn(async (alias: EWorkerImage) => {
        invocation += 1;
        activeOperations += 1;
        maximumConcurrency = Math.max(maximumConcurrency, activeOperations);
        if (invocation === 1) {
          markFirstStarted();
          await firstBlocked;
        }
        activeOperations -= 1;
        return {
          alias,
          contentId: IMAGE_ID_V1,
          desiredReference: BAILEYS_V1,
        };
      }),
    });

    const first = service.ensureImage(EWorkerImage.baileys);
    await firstStarted;
    const queuedAbort = new AbortController();
    const second = service.ensureImage(EWorkerImage.baileys, {
      abortSignal: queuedAbort.signal,
    });
    queuedAbort.abort();
    await expect(second).rejects.toThrow('worker_image_provision_aborted');

    const third = service.ensureImage(EWorkerImage.baileys);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(maximumConcurrency).toBe(1);
    expect(invocation).toBe(1);

    releaseFirst();
    await Promise.all([first, third]);
    expect(maximumConcurrency).toBe(1);
    expect(invocation).toBe(2);
  });

  it('coalesces concurrent default lookups across worker aliases', async () => {
    const docker = buildDockerHarness({
      [EWorkerImage.baileys]: IMAGE_ID_V1,
      [BAILEYS_V1]: IMAGE_ID_V1,
      [EWorkerImage.wwebjs]: IMAGE_ID_WWEBJS,
      [WWEBJS_V1]: IMAGE_ID_WWEBJS,
    });
    let releaseDefaults: (value: IServerBuildDefaultImages) => void = () =>
      undefined;
    const defaults = new Promise<IServerBuildDefaultImages>((resolve) => {
      releaseDefaults = resolve;
    });
    const getDefaultImages = jest.fn(async () => defaults);
    const service = buildProvisioner({ getDefaultImages, docker });

    const baileys = service.ensureImage(EWorkerImage.baileys);
    const wwebjs = service.ensureImage(EWorkerImage.wwebjs);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(getDefaultImages).toHaveBeenCalledTimes(1);
    releaseDefaults(buildDefaults());

    await expect(Promise.all([baileys, wwebjs])).resolves.toHaveLength(2);
    expect(getDefaultImages).toHaveBeenCalledTimes(1);
  });

  it('re-resolves a changed default after the short cache TTL expires', async () => {
    const docker = buildDockerHarness({
      [EWorkerImage.baileys]: IMAGE_ID_OLD,
      [BAILEYS_V1]: IMAGE_ID_V1,
      [BAILEYS_V2]: IMAGE_ID_V2,
    });
    const getDefaultImages = jest
      .fn()
      .mockResolvedValueOnce(buildDefaults(BAILEYS_V1))
      .mockResolvedValueOnce(buildDefaults(BAILEYS_V2));
    const service = buildProvisioner({ getDefaultImages, docker });
    const dateNow = jest.spyOn(Date, 'now');
    dateNow.mockReturnValue(1_000);

    const firstResult = await service.ensureImage(EWorkerImage.baileys);
    dateNow.mockReturnValue(1_101);
    const secondResult = await service.ensureImage(EWorkerImage.baileys);

    expect(firstResult.contentId).toBe(IMAGE_ID_V1);
    expect(secondResult.contentId).toBe(IMAGE_ID_V2);
    expect(docker.images.get(EWorkerImage.baileys)).toBe(IMAGE_ID_V2);
    expect(docker.tag).toHaveBeenCalledTimes(2);
    dateNow.mockRestore();
  });

  it('does not cache a failed default lookup', async () => {
    const docker = buildDockerHarness({
      [EWorkerImage.baileys]: IMAGE_ID_V1,
      [BAILEYS_V1]: IMAGE_ID_V1,
    });
    const getDefaultImages = jest
      .fn()
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce(buildDefaults());
    const service = buildProvisioner({ getDefaultImages, docker });

    await expect(service.ensureImage(EWorkerImage.baileys)).rejects.toThrow(
      'worker_image_default_resolution_failed'
    );
    await expect(service.ensureImage(EWorkerImage.baileys)).resolves.toEqual(
      expect.objectContaining({ contentId: IMAGE_ID_V1 })
    );
    expect(getDefaultImages).toHaveBeenCalledTimes(2);
  });

  it('fails closed and never retags when the authenticated pull fails', async () => {
    const docker = buildDockerHarness({
      [EWorkerImage.baileys]: IMAGE_ID_OLD,
    });
    docker.pullError = new Error(
      `registry rejected password ${HARBOR_PASSWORD}`
    );
    const service = buildProvisioner({
      getDefaultImages: jest.fn(async () => buildDefaults()),
      docker,
    });

    const result = service.ensureImage(EWorkerImage.baileys);
    await expect(result).rejects.toThrow('worker_image_pull_failed');
    await expect(result).rejects.not.toThrow(HARBOR_PASSWORD);
    expect(docker.images.get(EWorkerImage.baileys)).toBe(IMAGE_ID_OLD);
    expect(docker.tag).not.toHaveBeenCalled();
  });

  it('fails closed when post-retag content verification mismatches', async () => {
    const docker = buildDockerHarness({
      [EWorkerImage.baileys]: IMAGE_ID_OLD,
      [BAILEYS_V1]: IMAGE_ID_V1,
    });
    docker.shouldRetag = false;
    const service = buildProvisioner({
      getDefaultImages: jest.fn(async () => buildDefaults()),
      docker,
    });

    await expect(service.ensureImage(EWorkerImage.baileys)).rejects.toThrow(
      'worker_image_alias_verification_failed'
    );
    expect(docker.images.get(EWorkerImage.baileys)).toBe(IMAGE_ID_OLD);
  });

  it('does not downgrade a Docker 500 to cache-miss based on error text', async () => {
    const docker = buildDockerHarness({
      [EWorkerImage.baileys]: IMAGE_ID_OLD,
    });
    docker.getImage.mockImplementationOnce(() => ({
      inspect: jest.fn(async () => {
        throw Object.assign(new Error('No such image: daemon index failed'), {
          statusCode: 500,
        });
      }),
      tag: jest.fn(),
    }));
    const service = buildProvisioner({
      getDefaultImages: jest.fn(async () => buildDefaults()),
      docker,
    });

    await expect(service.ensureImage(EWorkerImage.baileys)).rejects.toThrow(
      'worker_image_inspection_failed'
    );
    expect(docker.pull).not.toHaveBeenCalled();
    expect(docker.tag).not.toHaveBeenCalled();
  });

  it('destroys an aborted pull and prevents its late callback from retagging', async () => {
    const docker = buildDockerHarness({
      [EWorkerImage.baileys]: IMAGE_ID_OLD,
    });
    const destroy = jest.fn();
    docker.pull.mockResolvedValue({
      reference: BAILEYS_V1,
      destroy,
    });
    let lateCallback: (error: Error | null) => void = () => undefined;
    let markProgressStarted: () => void = () => undefined;
    const progressStarted = new Promise<void>((resolve) => {
      markProgressStarted = resolve;
    });
    docker.followProgress.mockImplementationOnce(
      (_stream: unknown, callback: (error: Error | null) => void): void => {
        lateCallback = callback;
        markProgressStarted();
      }
    );
    const service = buildProvisioner({
      getDefaultImages: jest.fn(async () => buildDefaults()),
      docker,
    });
    const abortController = new AbortController();

    const provision = service.ensureImage(EWorkerImage.baileys, {
      abortSignal: abortController.signal,
    });
    await progressStarted;
    abortController.abort();

    await expect(provision).rejects.toThrow('worker_image_provision_aborted');
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(docker.tag).not.toHaveBeenCalled();

    lateCallback(null);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(docker.images.get(EWorkerImage.baileys)).toBe(IMAGE_ID_OLD);
    expect(docker.tag).not.toHaveBeenCalled();
  });

  it('rejects a mutable or foreign default before any Docker mutation', async () => {
    const foreignReference = 'docker.io/example/under-worker-baileys:latest';
    const docker = buildDockerHarness({
      [EWorkerImage.baileys]: IMAGE_ID_OLD,
    });
    const service = buildProvisioner({
      getDefaultImages: jest.fn(async () => buildDefaults(foreignReference)),
      docker,
    });

    await expect(service.ensureImage(EWorkerImage.baileys)).rejects.toThrow(
      'worker_image_default_repository_mismatch'
    );
    expect(docker.pull).not.toHaveBeenCalled();
    expect(docker.tag).not.toHaveBeenCalled();
  });

  it('allows only preloaded test-* overrides outside production', async () => {
    process.env.APP_ENVIRONMENT = 'LOCAL';
    const testReference = 'under-worker-baileys:test-candidate-1';
    process.env.WORKER_IMAGE_BAILEYS_REFERENCE = testReference;
    const docker = buildDockerHarness({
      [testReference]: IMAGE_ID_V2,
      [EWorkerImage.baileys]: IMAGE_ID_OLD,
    });
    const getDefaultImages = jest.fn();
    const service = buildProvisioner({ getDefaultImages, docker });

    await expect(service.ensureImage(EWorkerImage.baileys)).resolves.toEqual(
      expect.objectContaining({
        contentId: IMAGE_ID_V2,
        desiredReference: testReference,
      })
    );
    expect(getDefaultImages).not.toHaveBeenCalled();
    expect(docker.pull).not.toHaveBeenCalled();
    expect(docker.images.get(EWorkerImage.baileys)).toBe(IMAGE_ID_V2);
  });

  it('rejects test overrides in production without inspecting Docker', async () => {
    process.env.WORKER_IMAGE_BAILEYS_REFERENCE =
      'under-worker-baileys:test-candidate-1';
    const docker = buildDockerHarness({
      [EWorkerImage.baileys]: IMAGE_ID_OLD,
    });
    const service = buildProvisioner({
      getDefaultImages: jest.fn(),
      docker,
    });

    await expect(service.ensureImage(EWorkerImage.baileys)).rejects.toThrow(
      'WORKER_IMAGE_BAILEYS_REFERENCE is only allowed outside production.'
    );
    expect(docker.getImage).not.toHaveBeenCalled();
    expect(docker.pull).not.toHaveBeenCalled();
    expect(docker.tag).not.toHaveBeenCalled();
  });
});
