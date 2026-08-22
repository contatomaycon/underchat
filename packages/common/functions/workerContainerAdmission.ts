import { EWorkerImage } from '@core/common/enums/EWorkerImage';
import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';
import {
  IWorkerContainerResourcePolicy,
  resolveWorkerContainerResourcePolicy,
  WorkerContainerResourceProfile,
} from '@core/common/functions/workerContainerResourcePolicy';
import Docker from 'dockerode';
import { readFile } from 'node:fs/promises';

const MEBIBYTE = 1024 * 1024;
const SUPPORTED_IMAGES = new Set<EWorkerImage>([
  EWorkerImage.baileys,
  EWorkerImage.wwebjs,
  EWorkerImage.whatsmeow,
]);
const ACTIVE_CONTAINER_STATES = new Set([
  'created',
  'paused',
  'restarting',
  'running',
]);
const IMAGE_REPOSITORY_BY_ALIAS = new Map<EWorkerImage, string>([
  [EWorkerImage.baileys, 'under-worker-baileys'],
  [EWorkerImage.wwebjs, 'under-worker-wwebjs'],
  [EWorkerImage.whatsmeow, 'under-worker-whatsmeow'],
]);

type AdmissionOutcome =
  'approved' | 'disabled' | 'operation_failed' | 'rejected' | 'succeeded';

export interface WorkerContainerAdmissionStatus {
  readonly enabled: boolean;
  readonly evaluating: boolean;
  readonly queued_claims: number;
  readonly last_attempt_at: string | null;
  readonly last_success_at: string | null;
  readonly last_outcome: AdmissionOutcome | null;
  readonly last_reason: string | null;
  readonly host_total_memory_bytes: number | null;
  readonly host_available_memory_bytes: number | null;
  readonly host_reserved_memory_bytes: number | null;
  readonly allocatable_memory_bytes: number | null;
  readonly reservation_budget_bytes: number | null;
  readonly hard_limit_budget_bytes: number | null;
  readonly existing_reservation_bytes: number | null;
  readonly existing_hard_limit_bytes: number | null;
  readonly projected_reservation_bytes: number | null;
  readonly projected_hard_limit_bytes: number | null;
  readonly managed_container_count: number | null;
  readonly legacy_container_count: number | null;
  readonly replacement_credit_count: number | null;
  readonly requested_image: EWorkerImage | null;
  readonly requested_profile: WorkerContainerResourceProfile | null;
  readonly requested_reservation_bytes: number | null;
  readonly requested_hard_limit_bytes: number | null;
}

export interface WorkerContainerAdmissionRequest {
  readonly image: EWorkerImage;
  readonly profile: WorkerContainerResourceProfile;
  readonly policy: IWorkerContainerResourcePolicy;
  readonly replacingContainerName?: string;
}

interface AdmissionConfiguration {
  readonly hardLimitOvercommitPercent: number;
  readonly inspectConcurrency: number;
  readonly inspectTimeoutMs: number;
  readonly inventoryLimit: number;
  readonly reservationOvercommitPercent: number;
  readonly reservedMemoryMb: number;
  readonly reservedMemoryPercent: number;
}

interface AdmissionDocker {
  getContainer(reference: string): {
    inspect(): Promise<unknown>;
  };
  info(): Promise<unknown>;
  listContainers(options: { all: true }): Promise<unknown[]>;
}

interface ObservedResourceClaim {
  readonly hardLimitBytes: number;
  readonly legacy: boolean;
  readonly reservationBytes: number;
  readonly replacementCredit: boolean;
}

interface AdmissionAssessment {
  readonly allocatableMemoryBytes: number;
  readonly existingHardLimitBytes: number;
  readonly existingReservationBytes: number;
  readonly hardLimitBudgetBytes: number;
  readonly hostAvailableMemoryBytes: number;
  readonly hostReservedMemoryBytes: number;
  readonly hostTotalMemoryBytes: number;
  readonly legacyContainerCount: number;
  readonly managedContainerCount: number;
  readonly projectedHardLimitBytes: number;
  readonly projectedReservationBytes: number;
  readonly replacementCreditCount: number;
  readonly reservationBudgetBytes: number;
}

type HostAvailableMemoryReader = (timeoutMs: number) => Promise<number>;

export class WorkerContainerAdmissionError extends Error {
  constructor(readonly code: string) {
    super(`worker_container_admission_${code}`);
    this.name = 'WorkerContainerAdmissionError';
  }
}

function parseBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) {
    return fallback;
  }
  if (['1', 'true', 'yes', 'on'].includes(raw)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(raw)) {
    return false;
  }
  throw new InvalidConfigurationError(`${name} must be a boolean value.`);
}

function parseBoundedInteger(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new InvalidConfigurationError(
      `${name} must be an integer between ${minimum} and ${maximum}.`
    );
  }
  return parsed;
}

function loadConfiguration(): AdmissionConfiguration {
  return {
    /*
     * Reservation is the expected steady-state admission weight. A bounded
     * 150% overcommit keeps the 4/2/2 warm pool plus one active runtime of
     * each provider feasible on the 4 GiB test host.
     */
    reservationOvercommitPercent: parseBoundedInteger(
      'WORKER_CONTAINER_ADMISSION_RESERVATION_OVERCOMMIT_PERCENT',
      150,
      100,
      300
    ),
    /*
     * Hard limits remain a second, conservative catastrophe fence. They are
     * not summed 1:1 because mutually independent provider peaks would make
     * the required test topology impossible; the aggregate may never exceed
     * three times allocatable RAM unless an operator explicitly changes it.
     */
    hardLimitOvercommitPercent: parseBoundedInteger(
      'WORKER_CONTAINER_ADMISSION_HARD_LIMIT_OVERCOMMIT_PERCENT',
      300,
      100,
      400
    ),
    reservedMemoryMb: parseBoundedInteger(
      'WORKER_CONTAINER_HOST_RESERVED_MEMORY_MB',
      512,
      256,
      131_072
    ),
    reservedMemoryPercent: parseBoundedInteger(
      'WORKER_CONTAINER_HOST_RESERVED_MEMORY_PERCENT',
      15,
      5,
      80
    ),
    inventoryLimit: parseBoundedInteger(
      'WORKER_CONTAINER_ADMISSION_INVENTORY_LIMIT',
      1_000,
      1,
      10_000
    ),
    inspectConcurrency: parseBoundedInteger(
      'WORKER_CONTAINER_ADMISSION_INSPECT_CONCURRENCY',
      8,
      1,
      32
    ),
    inspectTimeoutMs: parseBoundedInteger(
      'WORKER_CONTAINER_ADMISSION_INSPECT_TIMEOUT_MS',
      5_000,
      500,
      30_000
    ),
  };
}

async function withDeadline<T>(
  operation: Promise<T>,
  timeoutMs: number,
  code: string
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(
      () => reject(new WorkerContainerAdmissionError(code)),
      timeoutMs
    );
    timeout.unref?.();
  });

  try {
    return await Promise.race([operation, deadline]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function readHostAvailableMemoryBytes(
  timeoutMs: number
): Promise<number> {
  const contents = await withDeadline(
    readFile('/proc/meminfo', 'utf8'),
    timeoutMs,
    'host_memory_available_timeout'
  );
  const match = /^MemAvailable:\s+([0-9]+)\s+kB$/mu.exec(contents);
  const kibibytes = Number(match?.[1]);
  const bytes = kibibytes * 1024;
  if (!Number.isSafeInteger(bytes) || bytes <= 0) {
    throw new WorkerContainerAdmissionError('host_memory_available_invalid');
  }
  return bytes;
}

function normalizeLabels(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  );
}

function normalizeContainerName(value: unknown): string {
  return typeof value === 'string' ? value.replace(/^\//u, '') : '';
}

function resolveImageAlias(...values: unknown[]): EWorkerImage | undefined {
  for (const raw of values) {
    if (typeof raw !== 'string') {
      continue;
    }
    const normalized = raw.trim().toLowerCase();
    if (SUPPORTED_IMAGES.has(normalized as EWorkerImage)) {
      return normalized as EWorkerImage;
    }
    for (const [alias, repository] of IMAGE_REPOSITORY_BY_ALIAS) {
      const escapedRepository = repository.replace(
        /[.*+?^${}()|[\]\\]/gu,
        '\\$&'
      );
      if (
        new RegExp(`(^|/)${escapedRepository}(?=[:@]|$)`, 'u').test(normalized)
      ) {
        return alias;
      }
    }
  }
  return undefined;
}

function isManagedWorkerShaped(
  labels: Record<string, string>,
  name: string
): boolean {
  return Boolean(
    labels['underchat.worker_id'] ||
    labels['underchat.warm_pool_id'] ||
    labels['underchat.worker_image'] ||
    labels['underchat.resource_policy'] ||
    name.startsWith('warm-')
  );
}

function positiveSafeInteger(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function nonNegativeSafeInteger(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function dockerNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error);
  return statusCode === 404 || message.includes('no such container');
}

async function mapBounded<T, R>(
  values: readonly T[],
  concurrency: number,
  deadlineMs: number,
  deadlineCode: string,
  operation: (value: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  let stopped = false;
  const runner = async (): Promise<void> => {
    try {
      while (!stopped && nextIndex < values.length) {
        const index = nextIndex++;
        results[index] = await operation(values[index]);
      }
    } catch (error) {
      stopped = true;
      throw error;
    }
  };
  const execution = Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => runner())
  );
  try {
    await withDeadline(execution, deadlineMs, deadlineCode);
    return results;
  } catch (error) {
    /*
     * Stop handing out new inspect work after either the first failure or the
     * aggregate deadline. At most `concurrency` already-bounded Docker calls
     * can remain in flight, so one unhealthy daemon cannot create an
     * unbounded background inventory storm after admission has failed closed.
     */
    stopped = true;
    throw error;
  }
}

function resolveProfile(
  labels: Record<string, string>,
  containerName: string
): WorkerContainerResourceProfile {
  const explicit = labels['underchat.resource_profile'];
  if (explicit === 'active' || explicit === 'warm') {
    return explicit;
  }
  return labels['underchat.warm_standby'] === 'true' ||
    containerName.startsWith('warm-')
    ? 'warm'
    : 'active';
}

function assertLabelMatchesNumber(
  labels: Record<string, string>,
  key: string,
  actual: number
): void {
  if (positiveSafeInteger(labels[key]) !== actual) {
    throw new WorkerContainerAdmissionError('resource_label_drift');
  }
}

function resolveObservedResourceClaim(input: {
  alias: EWorkerImage;
  containerName: string;
  hostConfig: Record<string, unknown>;
  imageId?: string;
  labels: Record<string, string>;
  replacingContainerName?: string;
}): ObservedResourceClaim {
  if (
    input.replacingContainerName &&
    input.containerName === input.replacingContainerName
  ) {
    return {
      hardLimitBytes: 0,
      legacy: false,
      replacementCredit: true,
      reservationBytes: 0,
    };
  }

  const profile = resolveProfile(input.labels, input.containerName);
  const fallbackPolicy = resolveWorkerContainerResourcePolicy(
    input.alias,
    profile
  );
  if (!fallbackPolicy) {
    throw new WorkerContainerAdmissionError('resource_policy_disabled');
  }

  const actualMemory = nonNegativeSafeInteger(input.hostConfig.Memory) ?? 0;
  const actualReservation =
    nonNegativeSafeInteger(input.hostConfig.MemoryReservation) ?? 0;
  const actualSwap = nonNegativeSafeInteger(input.hostConfig.MemorySwap) ?? 0;
  const actualNanoCpus = nonNegativeSafeInteger(input.hostConfig.NanoCpus) ?? 0;
  const actualPids = nonNegativeSafeInteger(input.hostConfig.PidsLimit) ?? 0;
  const actualOomScoreAdj =
    nonNegativeSafeInteger(input.hostConfig.OomScoreAdj) ?? 0;
  const policyVersion = input.labels['underchat.resource_policy'];
  const hasPolicyLabels = policyVersion === 'v1' || policyVersion === 'v2';

  if (hasPolicyLabels) {
    if (
      policyVersion === 'v2' &&
      input.labels['underchat.resource_profile'] !== profile
    ) {
      throw new WorkerContainerAdmissionError('resource_profile_drift');
    }
    if (
      actualMemory <= 0 ||
      actualReservation <= 0 ||
      actualSwap !== actualMemory ||
      actualNanoCpus <= 0 ||
      actualPids <= 0 ||
      actualOomScoreAdj <= 0 ||
      input.hostConfig.OomKillDisable === true
    ) {
      throw new WorkerContainerAdmissionError('resource_hostconfig_drift');
    }
    assertLabelMatchesNumber(
      input.labels,
      'underchat.resource_memory_bytes',
      actualMemory
    );
    assertLabelMatchesNumber(
      input.labels,
      'underchat.resource_memory_reservation_bytes',
      actualReservation
    );
    assertLabelMatchesNumber(
      input.labels,
      'underchat.resource_memory_swap_bytes',
      actualSwap
    );
    assertLabelMatchesNumber(
      input.labels,
      'underchat.resource_nano_cpus',
      actualNanoCpus
    );
    assertLabelMatchesNumber(
      input.labels,
      'underchat.resource_pids_limit',
      actualPids
    );
    assertLabelMatchesNumber(
      input.labels,
      'underchat.resource_oom_score_adj',
      actualOomScoreAdj
    );
    if (input.labels['underchat.resource_oom_kill_disable'] !== 'false') {
      throw new WorkerContainerAdmissionError('resource_label_drift');
    }
    const labelledImageId =
      input.labels['underchat.worker_image_content_id']?.toLowerCase();
    if (
      policyVersion === 'v2' &&
      (!labelledImageId ||
        !input.imageId ||
        labelledImageId !== input.imageId.toLowerCase())
    ) {
      throw new WorkerContainerAdmissionError('image_content_label_drift');
    }
    return {
      hardLimitBytes: actualMemory,
      legacy: false,
      replacementCredit: false,
      reservationBytes: actualReservation,
    };
  }

  /*
   * Legacy containers cannot be ignored and cannot all be rejected: doing so
   * would deadlock migration because the first bounded replacement could
   * never be created. Charge at least the current provider policy even when
   * Docker reports an old unlimited HostConfig, while the independent
   * MemAvailable gate prevents that migration allowance from hiding pressure.
   */
  return {
    hardLimitBytes: Math.max(actualMemory, fallbackPolicy.hostConfig.Memory),
    legacy: true,
    replacementCredit: false,
    reservationBytes: Math.max(
      actualReservation,
      fallbackPolicy.hostConfig.MemoryReservation
    ),
  };
}

function emptyStatus(): WorkerContainerAdmissionStatus {
  const configuredValue =
    process.env.WORKER_CONTAINER_ADMISSION_ENABLED?.trim();
  const enabled = parseBoolean('WORKER_CONTAINER_ADMISSION_ENABLED', false);

  return {
    enabled,
    evaluating: false,
    queued_claims: 0,
    last_attempt_at: null,
    last_success_at: null,
    last_outcome: enabled ? null : 'disabled',
    last_reason: enabled
      ? null
      : configuredValue
        ? 'explicitly_disabled'
        : 'disabled_by_default',
    host_total_memory_bytes: null,
    host_available_memory_bytes: null,
    host_reserved_memory_bytes: null,
    allocatable_memory_bytes: null,
    reservation_budget_bytes: null,
    hard_limit_budget_bytes: null,
    existing_reservation_bytes: null,
    existing_hard_limit_bytes: null,
    projected_reservation_bytes: null,
    projected_hard_limit_bytes: null,
    managed_container_count: null,
    legacy_container_count: null,
    replacement_credit_count: null,
    requested_image: null,
    requested_profile: null,
    requested_reservation_bytes: null,
    requested_hard_limit_bytes: null,
  };
}

export class WorkerContainerAdmissionController {
  private tail: Promise<void> = Promise.resolve();
  private queuedClaims = 0;
  private status: WorkerContainerAdmissionStatus = emptyStatus();

  constructor(
    private readonly availableMemoryReader: HostAvailableMemoryReader = readHostAvailableMemoryBytes
  ) {}

  public getStatus(): WorkerContainerAdmissionStatus {
    return { ...this.status };
  }

  public async run<T>(
    docker: AdmissionDocker,
    request: WorkerContainerAdmissionRequest,
    operation: () => Promise<T>
  ): Promise<T> {
    if (
      request.policy.image !== request.image ||
      request.policy.profile !== request.profile ||
      !SUPPORTED_IMAGES.has(request.image)
    ) {
      throw new WorkerContainerAdmissionError('request_policy_mismatch');
    }
    const admissionSetting =
      process.env.WORKER_CONTAINER_ADMISSION_ENABLED?.trim();
    const enabled = parseBoolean('WORKER_CONTAINER_ADMISSION_ENABLED', false);
    if (!enabled) {
      this.status = {
        ...emptyStatus(),
        enabled: false,
        last_attempt_at: new Date().toISOString(),
        last_outcome: 'disabled',
        last_reason: admissionSetting
          ? 'explicitly_disabled'
          : 'disabled_by_default',
        requested_image: request.image,
        requested_profile: request.profile,
        requested_hard_limit_bytes: request.policy.hostConfig.Memory,
        requested_reservation_bytes:
          request.policy.hostConfig.MemoryReservation,
      };
      return operation();
    }

    this.queuedClaims += 1;
    this.refreshQueueStatus(this.status.evaluating);
    const previous = this.tail.catch(() => undefined);
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.tail = previous.then(() => gate);
    await previous;
    this.queuedClaims -= 1;
    this.refreshQueueStatus(true);

    let operationStarted = false;
    try {
      const configuration = loadConfiguration();
      const assessment = await this.assess(docker, request, configuration);
      this.status = this.buildStatus(
        request,
        assessment,
        'approved',
        null,
        true
      );
      operationStarted = true;
      try {
        const result = await operation();
        this.status = {
          ...this.status,
          evaluating: false,
          queued_claims: this.queuedClaims,
          last_outcome: 'succeeded',
          last_success_at: new Date().toISOString(),
        };
        return result;
      } catch (error) {
        this.status = {
          ...this.status,
          evaluating: false,
          queued_claims: this.queuedClaims,
          last_outcome: 'operation_failed',
          last_reason: 'container_operation_failed',
        };
        throw error;
      }
    } catch (error) {
      if (operationStarted) {
        throw error;
      }
      const reason =
        error instanceof WorkerContainerAdmissionError
          ? error.code
          : 'inventory_unavailable';
      this.status = {
        ...this.status,
        enabled: true,
        evaluating: false,
        queued_claims: this.queuedClaims,
        last_attempt_at: new Date().toISOString(),
        last_outcome: 'rejected',
        last_reason: reason,
        requested_image: request.image,
        requested_profile: request.profile,
        requested_hard_limit_bytes: request.policy.hostConfig.Memory,
        requested_reservation_bytes:
          request.policy.hostConfig.MemoryReservation,
      };
      if (error instanceof WorkerContainerAdmissionError) {
        throw error;
      }
      throw new WorkerContainerAdmissionError('inventory_unavailable');
    } finally {
      release?.();
    }
  }

  private refreshQueueStatus(evaluating: boolean): void {
    this.status = {
      ...this.status,
      enabled: true,
      evaluating,
      queued_claims: this.queuedClaims,
    };
  }

  private buildStatus(
    request: WorkerContainerAdmissionRequest,
    assessment: AdmissionAssessment,
    outcome: AdmissionOutcome,
    reason: string | null,
    evaluating: boolean
  ): WorkerContainerAdmissionStatus {
    return {
      enabled: true,
      evaluating,
      queued_claims: this.queuedClaims,
      last_attempt_at: new Date().toISOString(),
      last_success_at: this.status.last_success_at,
      last_outcome: outcome,
      last_reason: reason,
      host_total_memory_bytes: assessment.hostTotalMemoryBytes,
      host_available_memory_bytes: assessment.hostAvailableMemoryBytes,
      host_reserved_memory_bytes: assessment.hostReservedMemoryBytes,
      allocatable_memory_bytes: assessment.allocatableMemoryBytes,
      reservation_budget_bytes: assessment.reservationBudgetBytes,
      hard_limit_budget_bytes: assessment.hardLimitBudgetBytes,
      existing_reservation_bytes: assessment.existingReservationBytes,
      existing_hard_limit_bytes: assessment.existingHardLimitBytes,
      projected_reservation_bytes: assessment.projectedReservationBytes,
      projected_hard_limit_bytes: assessment.projectedHardLimitBytes,
      managed_container_count: assessment.managedContainerCount,
      legacy_container_count: assessment.legacyContainerCount,
      replacement_credit_count: assessment.replacementCreditCount,
      requested_image: request.image,
      requested_profile: request.profile,
      requested_reservation_bytes: request.policy.hostConfig.MemoryReservation,
      requested_hard_limit_bytes: request.policy.hostConfig.Memory,
    };
  }

  private async assess(
    docker: AdmissionDocker,
    request: WorkerContainerAdmissionRequest,
    configuration: AdmissionConfiguration
  ): Promise<AdmissionAssessment> {
    const [rawInfo, rawContainers, hostAvailableMemoryBytes] =
      await Promise.all([
        withDeadline(
          docker.info(),
          configuration.inspectTimeoutMs,
          'docker_info_timeout'
        ),
        withDeadline(
          docker.listContainers({ all: true }),
          configuration.inspectTimeoutMs,
          'docker_inventory_timeout'
        ),
        this.availableMemoryReader(configuration.inspectTimeoutMs),
      ]);
    const hostTotalMemoryBytes = positiveSafeInteger(
      (rawInfo as { MemTotal?: unknown })?.MemTotal
    );
    if (
      !hostTotalMemoryBytes ||
      hostAvailableMemoryBytes > hostTotalMemoryBytes
    ) {
      throw new WorkerContainerAdmissionError('host_memory_invalid');
    }

    const candidates = rawContainers
      .map((raw) => {
        const container = raw as {
          Id?: unknown;
          Image?: unknown;
          Labels?: unknown;
          Names?: unknown;
          State?: unknown;
        };
        const labels = normalizeLabels(container.Labels);
        const names = Array.isArray(container.Names)
          ? container.Names.filter(
              (name): name is string => typeof name === 'string'
            )
          : [];
        const name = normalizeContainerName(names[0]);
        const alias = resolveImageAlias(
          labels['underchat.worker_image'],
          container.Image
        );
        const managedShaped = isManagedWorkerShaped(labels, name);
        if (!alias && !managedShaped) {
          return null;
        }
        if (!alias) {
          throw new WorkerContainerAdmissionError(
            'managed_container_image_ambiguous'
          );
        }
        const id = typeof container.Id === 'string' ? container.Id : '';
        if (!/^[0-9a-f]{12,64}$/iu.test(id)) {
          throw new WorkerContainerAdmissionError(
            'managed_container_id_invalid'
          );
        }
        return { alias, id };
      })
      .filter(
        (
          candidate
        ): candidate is {
          alias: EWorkerImage;
          id: string;
        } => candidate !== null
      );
    if (candidates.length > configuration.inventoryLimit) {
      throw new WorkerContainerAdmissionError('inventory_limit_exceeded');
    }

    const claims = (
      await mapBounded(
        candidates,
        configuration.inspectConcurrency,
        configuration.inspectTimeoutMs,
        'container_inventory_inspect_timeout',
        async (candidate): Promise<ObservedResourceClaim | null> => {
          let rawInspection: unknown;
          try {
            rawInspection = await withDeadline(
              docker.getContainer(candidate.id).inspect(),
              configuration.inspectTimeoutMs,
              'container_inspect_timeout'
            );
          } catch (error) {
            if (dockerNotFound(error)) {
              return null;
            }
            throw error;
          }
          const inspection = rawInspection as {
            Config?: {
              Image?: unknown;
              Labels?: unknown;
            };
            HostConfig?: Record<string, unknown>;
            Image?: unknown;
            Name?: unknown;
            State?: {
              Paused?: unknown;
              Restarting?: unknown;
              Running?: unknown;
              Status?: unknown;
            };
          };
          const state = inspection.State;
          const stateName =
            typeof state?.Status === 'string' ? state.Status.toLowerCase() : '';
          const consumesClaim =
            state?.Running === true ||
            state?.Restarting === true ||
            state?.Paused === true ||
            ACTIVE_CONTAINER_STATES.has(stateName);
          if (!consumesClaim) {
            return null;
          }
          const labels = normalizeLabels(inspection.Config?.Labels);
          const alias = resolveImageAlias(
            labels['underchat.worker_image'],
            inspection.Config?.Image,
            candidate.alias
          );
          if (!alias) {
            throw new WorkerContainerAdmissionError(
              'managed_container_image_ambiguous'
            );
          }
          return resolveObservedResourceClaim({
            alias,
            containerName: normalizeContainerName(inspection.Name),
            hostConfig: inspection.HostConfig ?? {},
            imageId:
              typeof inspection.Image === 'string'
                ? inspection.Image
                : undefined,
            labels,
            replacingContainerName: request.replacingContainerName,
          });
        }
      )
    ).filter((claim): claim is ObservedResourceClaim => claim !== null);

    const existingHardLimitBytes = claims.reduce(
      (total, claim) => total + claim.hardLimitBytes,
      0
    );
    const existingReservationBytes = claims.reduce(
      (total, claim) => total + claim.reservationBytes,
      0
    );
    const replacementCreditCount = claims.filter(
      (claim) => claim.replacementCredit
    ).length;
    const managedContainerCount = claims.length - replacementCreditCount;
    const legacyContainerCount = claims.filter((claim) => claim.legacy).length;
    const hostReservedMemoryBytes = Math.max(
      configuration.reservedMemoryMb * MEBIBYTE,
      Math.ceil(
        (hostTotalMemoryBytes * configuration.reservedMemoryPercent) / 100
      )
    );
    const allocatableMemoryBytes =
      hostTotalMemoryBytes - hostReservedMemoryBytes;
    if (allocatableMemoryBytes <= 0) {
      throw new WorkerContainerAdmissionError(
        'capacity_host_headroom_configuration_impossible'
      );
    }
    const reservationBudgetBytes = Math.floor(
      (allocatableMemoryBytes * configuration.reservationOvercommitPercent) /
        100
    );
    const hardLimitBudgetBytes = Math.floor(
      (allocatableMemoryBytes * configuration.hardLimitOvercommitPercent) / 100
    );
    const projectedReservationBytes =
      existingReservationBytes + request.policy.hostConfig.MemoryReservation;
    const projectedHardLimitBytes =
      existingHardLimitBytes + request.policy.hostConfig.Memory;
    const assessment: AdmissionAssessment = {
      allocatableMemoryBytes,
      existingHardLimitBytes,
      existingReservationBytes,
      hardLimitBudgetBytes,
      hostAvailableMemoryBytes,
      hostReservedMemoryBytes,
      hostTotalMemoryBytes,
      legacyContainerCount,
      managedContainerCount,
      projectedHardLimitBytes,
      projectedReservationBytes,
      replacementCreditCount,
      reservationBudgetBytes,
    };
    this.status = this.buildStatus(request, assessment, 'approved', null, true);

    if (
      request.policy.hostConfig.Memory > hardLimitBudgetBytes ||
      request.policy.hostConfig.MemoryReservation > reservationBudgetBytes
    ) {
      throw new WorkerContainerAdmissionError(
        'capacity_request_exceeds_host_budget'
      );
    }
    if (projectedReservationBytes > reservationBudgetBytes) {
      throw new WorkerContainerAdmissionError('capacity_reservation_exhausted');
    }
    if (projectedHardLimitBytes > hardLimitBudgetBytes) {
      throw new WorkerContainerAdmissionError('capacity_hard_limit_exhausted');
    }

    const immediateAdmissionBytes =
      replacementCreditCount > 0
        ? 0
        : Math.ceil(
            (request.policy.hostConfig.MemoryReservation * 100) /
              configuration.reservationOvercommitPercent
          );
    if (
      hostAvailableMemoryBytes - immediateAdmissionBytes <
      hostReservedMemoryBytes
    ) {
      throw new WorkerContainerAdmissionError(
        'capacity_host_available_memory_exhausted'
      );
    }

    return assessment;
  }
}

const defaultAdmissionController = new WorkerContainerAdmissionController();

export async function runWithWorkerContainerAdmission<T>(
  docker: Docker,
  request: WorkerContainerAdmissionRequest,
  operation: () => Promise<T>
): Promise<T> {
  return defaultAdmissionController.run(
    docker as unknown as AdmissionDocker,
    request,
    operation
  );
}

export function getWorkerContainerAdmissionStatus(): WorkerContainerAdmissionStatus {
  return defaultAdmissionController.getStatus();
}
