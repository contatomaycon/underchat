import { EAppEnvironment } from '@core/common/enums/EAppEnvironment';
import { EWorkerImage } from '@core/common/enums/EWorkerImage';
import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';
import { IServerBuildDefaultImages } from '@core/common/interfaces/IServerBuildDefaultImages';
import { buildEnvironment } from '@core/config/environments';
import { ServerBuildService } from '@core/services/serverBuild.service';
import Docker from 'dockerode';
import { inject, singleton } from 'tsyringe';

const CANONICAL_IMAGE_ID_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const DIGEST_REFERENCE_PATTERN = /@sha256:[0-9a-f]{64}$/u;
const IMMUTABLE_BUILD_TAG_PATTERN = /^v[0-9]+$/u;
const TEST_OVERRIDE_TAG_PATTERN = /^test-[a-z0-9][a-z0-9_.-]*$/u;

interface WorkerImageTarget {
  readonly alias: EWorkerImage;
  readonly defaultKey: 'baileys' | 'wwebjs' | 'whatsmeow';
  readonly imageName:
    'under-worker-baileys' | 'under-worker-wwebjs' | 'under-worker-whatsmeow';
  readonly overrideEnvironmentName:
    | 'WORKER_IMAGE_BAILEYS_REFERENCE'
    | 'WORKER_IMAGE_WWEBJS_REFERENCE'
    | 'WORKER_IMAGE_WHATSMEOW_REFERENCE';
}

interface ResolvedWorkerImageReference {
  readonly reference: string;
  readonly shouldPullWhenMissing: boolean;
}

export interface WorkerImageProvisionResult {
  readonly alias: EWorkerImage;
  readonly contentId: string;
  readonly desiredReference: string;
}

export interface WorkerImageProvisionOptions {
  readonly abortSignal?: AbortSignal;
}

const WORKER_IMAGE_TARGETS = new Map<EWorkerImage, WorkerImageTarget>([
  [
    EWorkerImage.baileys,
    {
      alias: EWorkerImage.baileys,
      defaultKey: 'baileys',
      imageName: 'under-worker-baileys',
      overrideEnvironmentName: 'WORKER_IMAGE_BAILEYS_REFERENCE',
    },
  ],
  [
    EWorkerImage.wwebjs,
    {
      alias: EWorkerImage.wwebjs,
      defaultKey: 'wwebjs',
      imageName: 'under-worker-wwebjs',
      overrideEnvironmentName: 'WORKER_IMAGE_WWEBJS_REFERENCE',
    },
  ],
  [
    EWorkerImage.whatsmeow,
    {
      alias: EWorkerImage.whatsmeow,
      defaultKey: 'whatsmeow',
      imageName: 'under-worker-whatsmeow',
      overrideEnvironmentName: 'WORKER_IMAGE_WHATSMEOW_REFERENCE',
    },
  ],
]);

/*
 * WorkerService is resolved through dependency injection in more than one
 * control-plane path. Keep the mutex at module scope so every provisioner
 * instance in this Balance process shares the same per-alias critical section.
 */
const provisionTails = new Map<EWorkerImage, Promise<void>>();

class WorkerImageProvisionError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'WorkerImageProvisionError';
  }
}

function getDockerErrorStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }

  const value = (error as { statusCode?: unknown }).statusCode;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  return undefined;
}

function isDockerImageNotFoundError(error: unknown): boolean {
  const statusCode = getDockerErrorStatusCode(error);
  if (statusCode !== undefined) {
    return statusCode === 404;
  }

  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error);
  return message.includes('no such image');
}

function normalizeCanonicalImageId(value: unknown): string {
  const contentId = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!CANONICAL_IMAGE_ID_PATTERN.test(contentId)) {
    throw new WorkerImageProvisionError('worker_image_content_id_invalid');
  }

  return contentId;
}

function parseReferenceTag(reference: string): string | null {
  const lastSlashIndex = reference.lastIndexOf('/');
  const lastColonIndex = reference.lastIndexOf(':');
  if (lastColonIndex <= lastSlashIndex) {
    return null;
  }

  return reference.slice(lastColonIndex + 1);
}

function parseAlias(alias: EWorkerImage): { repo: string; tag: string } {
  const lastColonIndex = alias.lastIndexOf(':');
  if (lastColonIndex <= 0 || lastColonIndex === alias.length - 1) {
    throw new WorkerImageProvisionError('worker_image_alias_invalid');
  }

  return {
    repo: alias.slice(0, lastColonIndex),
    tag: alias.slice(lastColonIndex + 1),
  };
}

function assertReferenceSyntax(reference: string): void {
  if (
    !reference ||
    reference.length > 512 ||
    /[\u0000-\u0020\u007f]/u.test(reference) ||
    reference.startsWith('-')
  ) {
    throw new WorkerImageProvisionError('worker_image_reference_invalid');
  }
}

function isTestEnvironment(): boolean {
  return (
    process.env.APP_ENVIRONMENT === EAppEnvironment.local ||
    process.env.APP_ENVIRONMENT === EAppEnvironment.dev ||
    process.env.APP_ENVIRONMENT === EAppEnvironment.hmg
  );
}

async function runSerialized<T>(
  alias: EWorkerImage,
  abortSignal: AbortSignal,
  operation: () => Promise<T>
): Promise<T> {
  const previousTail = provisionTails.get(alias) ?? Promise.resolve();
  let releaseCurrent: (() => void) | undefined;
  const currentGate = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  const currentTail = previousTail
    .catch(() => undefined)
    .then(() => currentGate);
  provisionTails.set(alias, currentTail);

  try {
    await waitForSignal(
      previousTail.catch(() => undefined),
      abortSignal
    );
  } catch (error) {
    releaseCurrent?.();
    /*
     * The canceled waiter still represents a queue link until its predecessor
     * settles. Removing it eagerly would let a later caller bypass the active
     * owner. Release its gate, but retire the tail only after the predecessor
     * chain has actually completed.
     */
    void currentTail.then(() => {
      if (provisionTails.get(alias) === currentTail) {
        provisionTails.delete(alias);
      }
    });
    throw error;
  }

  try {
    return await operation();
  } finally {
    releaseCurrent?.();
    if (provisionTails.get(alias) === currentTail) {
      provisionTails.delete(alias);
    }
  }
}

function provisionAbortError(abortSignal: AbortSignal): Error {
  const reason =
    abortSignal.reason === 'worker_image_provision_aborted'
      ? 'worker_image_provision_aborted'
      : 'worker_image_provision_timeout';
  return new WorkerImageProvisionError(reason);
}

async function waitForSignal<T>(
  operation: Promise<T>,
  abortSignal: AbortSignal
): Promise<T> {
  if (abortSignal.aborted) {
    throw provisionAbortError(abortSignal);
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (handler: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      abortSignal.removeEventListener('abort', onAbort);
      handler();
    };
    const onAbort = (): void => {
      finish(() => reject(provisionAbortError(abortSignal)));
    };

    abortSignal.addEventListener('abort', onAbort, { once: true });
    operation.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error))
    );

    if (abortSignal.aborted) {
      onAbort();
    }
  });
}

@singleton()
export class WorkerImageProvisionerService {
  private readonly docker: Docker;
  private cachedDefaults:
    | {
        readonly expiresAt: number;
        readonly value: IServerBuildDefaultImages;
      }
    | undefined;
  private defaultsInFlight: Promise<IServerBuildDefaultImages | null> | null =
    null;

  constructor(
    @inject(ServerBuildService)
    private readonly serverBuildService: ServerBuildService
  ) {
    this.docker = new Docker({
      socketPath: '/var/run/docker.sock',
      timeout: buildEnvironment.workerImageProvisionTimeoutMs,
    });
  }

  public async ensureImage(
    alias: EWorkerImage,
    options: WorkerImageProvisionOptions = {}
  ): Promise<WorkerImageProvisionResult> {
    const timeoutMs = buildEnvironment.workerImageProvisionTimeoutMs;
    const abortController = new AbortController();
    const abortFromCaller = (): void => {
      abortController.abort('worker_image_provision_aborted');
    };
    if (options.abortSignal?.aborted) {
      abortFromCaller();
    } else {
      options.abortSignal?.addEventListener('abort', abortFromCaller, {
        once: true,
      });
    }
    const timeout = setTimeout(
      () => abortController.abort('worker_image_provision_timeout'),
      timeoutMs
    );
    timeout.unref?.();

    try {
      return await runSerialized(alias, abortController.signal, () =>
        this.ensureImageLocked(alias, abortController.signal)
      );
    } finally {
      clearTimeout(timeout);
      options.abortSignal?.removeEventListener('abort', abortFromCaller);
    }
  }

  private async ensureImageLocked(
    alias: EWorkerImage,
    abortSignal: AbortSignal
  ): Promise<WorkerImageProvisionResult> {
    const target = WORKER_IMAGE_TARGETS.get(alias);
    if (!target) {
      const existingContentId = await this.inspectImageContentId(
        alias,
        abortSignal
      );
      if (!existingContentId) {
        throw new WorkerImageProvisionError(
          'worker_image_unsupported_alias_missing'
        );
      }

      return {
        alias,
        contentId: existingContentId,
        desiredReference: alias,
      };
    }

    const desired = await this.resolveDesiredReference(target, abortSignal);
    this.assertNotAborted(abortSignal);

    let desiredContentId = await this.inspectImageContentId(
      desired.reference,
      abortSignal
    );
    if (!desiredContentId) {
      if (!desired.shouldPullWhenMissing) {
        throw new WorkerImageProvisionError(
          'worker_image_test_override_not_loaded'
        );
      }

      await this.pullImage(desired.reference, abortSignal);
      this.assertNotAborted(abortSignal);
      desiredContentId = await this.inspectImageContentId(
        desired.reference,
        abortSignal
      );
      if (!desiredContentId) {
        throw new WorkerImageProvisionError('worker_image_missing_after_pull');
      }
    }

    const currentAliasContentId = await this.inspectImageContentId(
      alias,
      abortSignal
    );
    if (currentAliasContentId === desiredContentId) {
      return {
        alias,
        contentId: desiredContentId,
        desiredReference: desired.reference,
      };
    }

    this.assertNotAborted(abortSignal);
    const parsedAlias = parseAlias(alias);
    try {
      await this.docker.getImage(desired.reference).tag({
        repo: parsedAlias.repo,
        tag: parsedAlias.tag,
        abortSignal,
      });
    } catch {
      throw new WorkerImageProvisionError('worker_image_retag_failed');
    }
    this.assertNotAborted(abortSignal);

    const [desiredContentIdAfterTag, aliasContentIdAfterTag] =
      await Promise.all([
        this.inspectImageContentId(desired.reference, abortSignal),
        this.inspectImageContentId(alias, abortSignal),
      ]);
    if (
      desiredContentIdAfterTag !== desiredContentId ||
      aliasContentIdAfterTag !== desiredContentId
    ) {
      throw new WorkerImageProvisionError(
        'worker_image_alias_verification_failed'
      );
    }

    return {
      alias,
      contentId: desiredContentId,
      desiredReference: desired.reference,
    };
  }

  private async resolveDesiredReference(
    target: WorkerImageTarget,
    abortSignal: AbortSignal
  ): Promise<ResolvedWorkerImageReference> {
    const override = process.env[target.overrideEnvironmentName]?.trim() ?? '';
    if (override) {
      if (!isTestEnvironment()) {
        throw new InvalidConfigurationError(
          `${target.overrideEnvironmentName} is only allowed outside production.`
        );
      }

      this.assertAllowedTestOverride(target, override);
      return {
        reference: override,
        shouldPullWhenMissing: this.isExpectedHarborReference(target, override),
      };
    }

    let defaults: IServerBuildDefaultImages | null;
    try {
      defaults = await this.getDefaultImages(abortSignal);
    } catch {
      this.assertNotAborted(abortSignal);
      throw new WorkerImageProvisionError(
        'worker_image_default_resolution_failed'
      );
    }
    this.assertNotAborted(abortSignal);
    if (!defaults) {
      throw new WorkerImageProvisionError('worker_image_default_missing');
    }

    const reference = defaults[target.defaultKey]?.trim() ?? '';
    this.assertAllowedDefaultReference(target, reference);

    return {
      reference,
      shouldPullWhenMissing: true,
    };
  }

  private assertAllowedDefaultReference(
    target: WorkerImageTarget,
    reference: string
  ): void {
    assertReferenceSyntax(reference);
    if (!this.isExpectedHarborReference(target, reference)) {
      throw new WorkerImageProvisionError(
        'worker_image_default_repository_mismatch'
      );
    }

    if (DIGEST_REFERENCE_PATTERN.test(reference)) {
      return;
    }

    const tag = parseReferenceTag(reference);
    if (!tag || !IMMUTABLE_BUILD_TAG_PATTERN.test(tag)) {
      throw new WorkerImageProvisionError(
        'worker_image_default_reference_not_immutable'
      );
    }
  }

  private assertAllowedTestOverride(
    target: WorkerImageTarget,
    reference: string
  ): void {
    assertReferenceSyntax(reference);
    const localRepository = target.alias.slice(
      0,
      target.alias.lastIndexOf(':')
    );
    const isLocalTestReference =
      reference.startsWith(`${localRepository}:`) && !reference.includes('/');
    const isHarborTestReference = this.isExpectedHarborReference(
      target,
      reference
    );
    if (!isLocalTestReference && !isHarborTestReference) {
      throw new WorkerImageProvisionError(
        'worker_image_test_override_repository_mismatch'
      );
    }

    if (DIGEST_REFERENCE_PATTERN.test(reference)) {
      return;
    }

    const tag = parseReferenceTag(reference);
    if (!tag || !TEST_OVERRIDE_TAG_PATTERN.test(tag)) {
      throw new WorkerImageProvisionError(
        'worker_image_test_override_not_immutable'
      );
    }
  }

  private isExpectedHarborReference(
    target: WorkerImageTarget,
    reference: string
  ): boolean {
    const registry = buildEnvironment.harborRegistry.replace(/\/+$/u, '');
    const namespace = buildEnvironment.harborNamespace;
    const repository = `${registry}/${namespace}/${target.imageName}`;

    return (
      reference.startsWith(`${repository}:`) ||
      reference.startsWith(`${repository}@`)
    );
  }

  private async inspectImageContentId(
    reference: string,
    abortSignal: AbortSignal
  ): Promise<string | null> {
    this.assertNotAborted(abortSignal);
    try {
      const inspection = await this.waitForAbort(
        this.docker.getImage(reference).inspect(),
        abortSignal
      );
      return normalizeCanonicalImageId(inspection.Id);
    } catch (error) {
      if (isDockerImageNotFoundError(error)) {
        return null;
      }
      if (error instanceof WorkerImageProvisionError) {
        throw error;
      }
      throw new WorkerImageProvisionError('worker_image_inspection_failed');
    }
  }

  private async pullImage(
    reference: string,
    abortSignal: AbortSignal
  ): Promise<void> {
    this.assertNotAborted(abortSignal);
    let stream: NodeJS.ReadableStream;
    try {
      stream = await this.waitForAbort(
        this.docker.pull(reference, {
          abortSignal,
          authconfig: {
            username: buildEnvironment.harborUsername,
            password: buildEnvironment.harborPassword,
            serveraddress: buildEnvironment.harborRegistry,
          },
        }),
        abortSignal
      );
    } catch {
      this.assertNotAborted(abortSignal);
      throw new WorkerImageProvisionError('worker_image_pull_failed');
    }

    await this.followPullProgress(stream, abortSignal);
    this.assertNotAborted(abortSignal);
  }

  private assertNotAborted(abortSignal: AbortSignal): void {
    if (abortSignal.aborted) {
      throw provisionAbortError(abortSignal);
    }
  }

  private async getDefaultImages(
    abortSignal: AbortSignal
  ): Promise<IServerBuildDefaultImages | null> {
    const now = Date.now();
    if (this.cachedDefaults && this.cachedDefaults.expiresAt > now) {
      return this.cachedDefaults.value;
    }

    if (!this.defaultsInFlight) {
      const request = this.serverBuildService
        .getDefaultImages()
        .then((defaults) => {
          if (defaults) {
            this.cachedDefaults = {
              expiresAt:
                Date.now() + buildEnvironment.workerImageDefaultCacheTtlMs,
              value: defaults,
            };
          }
          return defaults;
        });
      this.defaultsInFlight = request;
      const clearRequest = (): void => {
        if (this.defaultsInFlight === request) {
          this.defaultsInFlight = null;
        }
      };
      void request.then(clearRequest, clearRequest);
    }

    return this.waitForAbort(
      this.defaultsInFlight as Promise<IServerBuildDefaultImages | null>,
      abortSignal
    );
  }

  private async followPullProgress(
    stream: NodeJS.ReadableStream,
    abortSignal: AbortSignal
  ): Promise<void> {
    this.assertNotAborted(abortSignal);

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error): void => {
        if (settled) {
          return;
        }
        settled = true;
        abortSignal.removeEventListener('abort', onAbort);
        if (error) {
          reject(error);
          return;
        }
        resolve();
      };
      const onAbort = (): void => {
        const destroy = (
          stream as NodeJS.ReadableStream & {
            destroy?: (error?: Error) => void;
          }
        ).destroy;
        if (typeof destroy === 'function') {
          destroy.call(stream);
        }
        try {
          this.assertNotAborted(abortSignal);
        } catch (error) {
          finish(error as Error);
        }
      };

      abortSignal.addEventListener('abort', onAbort, { once: true });
      try {
        this.docker.modem.followProgress(stream, (error: unknown) => {
          if (error) {
            finish(new WorkerImageProvisionError('worker_image_pull_failed'));
            return;
          }
          finish();
        });
      } catch {
        finish(new WorkerImageProvisionError('worker_image_pull_failed'));
      }

      if (abortSignal.aborted) {
        onAbort();
      }
    });
  }

  private async waitForAbort<T>(
    operation: Promise<T>,
    abortSignal: AbortSignal
  ): Promise<T> {
    this.assertNotAborted(abortSignal);

    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (handler: () => void): void => {
        if (settled) {
          return;
        }
        settled = true;
        abortSignal.removeEventListener('abort', onAbort);
        handler();
      };
      const onAbort = (): void => {
        finish(() => {
          try {
            this.assertNotAborted(abortSignal);
          } catch (error) {
            reject(error);
          }
        });
      };

      abortSignal.addEventListener('abort', onAbort, { once: true });
      operation.then(
        (value) => finish(() => resolve(value)),
        (error: unknown) => finish(() => reject(error))
      );

      if (abortSignal.aborted) {
        onAbort();
      }
    });
  }
}
