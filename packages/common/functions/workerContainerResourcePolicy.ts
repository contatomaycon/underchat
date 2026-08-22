import { EWorkerImage } from '@core/common/enums/EWorkerImage';
import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';

const MEBIBYTE = 1024 * 1024;
const NANO_CPUS_PER_CPU = 1_000_000_000;

interface IWorkerResourceDefaults {
  cpuMillis: number;
  memoryMb: number;
  pidsLimit: number;
}

export type WorkerContainerResourceProfile = 'active' | 'warm';

export interface IWorkerContainerResourcePolicy {
  readonly image: EWorkerImage;
  readonly profile: WorkerContainerResourceProfile;
  readonly hostConfig: {
    Memory: number;
    MemoryReservation: number;
    MemorySwap: number;
    NanoCpus: number;
    OomKillDisable: false;
    OomScoreAdj: number;
    PidsLimit: number;
  };
  readonly labels: Readonly<Record<string, string>>;
}

const DEFAULTS_BY_IMAGE: Readonly<
  Partial<Record<EWorkerImage, IWorkerResourceDefaults>>
> = {
  [EWorkerImage.baileys]: {
    cpuMillis: 1_500,
    memoryMb: 1_536,
    pidsLimit: 512,
  },
  [EWorkerImage.wwebjs]: {
    cpuMillis: 2_000,
    memoryMb: 3_072,
    pidsLimit: 512,
  },
  [EWorkerImage.whatsmeow]: {
    cpuMillis: 1_000,
    memoryMb: 1_024,
    pidsLimit: 512,
  },
};

/*
 * A legacy-volume warm standby has no provider session, Chromium or channel
 * consumers. Activation replaces that container with an active runtime, so
 * the smaller boundary below is never inherited by a serving channel.
 * PostgreSQL warms are promoted in place and WorkerService deliberately gives
 * them DEFAULTS_BY_IMAGE from creation time instead.
 */
const WARM_DEFAULTS_BY_IMAGE: Readonly<
  Partial<Record<EWorkerImage, IWorkerResourceDefaults>>
> = {
  [EWorkerImage.baileys]: {
    cpuMillis: 250,
    memoryMb: 256,
    pidsLimit: 128,
  },
  [EWorkerImage.wwebjs]: {
    cpuMillis: 250,
    memoryMb: 384,
    pidsLimit: 256,
  },
  [EWorkerImage.whatsmeow]: {
    cpuMillis: 250,
    memoryMb: 192,
    pidsLimit: 128,
  },
};

const ENV_SUFFIX_BY_IMAGE: Readonly<Partial<Record<EWorkerImage, string>>> = {
  [EWorkerImage.baileys]: 'BAILEYS',
  [EWorkerImage.wwebjs]: 'WWEBJS',
  [EWorkerImage.whatsmeow]: 'WHATSMEOW',
};

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

/**
 * A worker is an untrusted resource boundary from the host's point of view:
 * a Chromium leak, a reconnect loop or an oversized history sync must be able
 * to restart that channel, but must never exhaust the whole Balance server.
 *
 * Legacy warm containers use a smaller bootstrap profile. PostgreSQL warm
 * containers are reusable runtimes and receive the active profile before they
 * can ever be activated; Docker restart/recovery then preserves that immutable
 * boundary.
 */
export function resolveWorkerContainerResourcePolicy(
  image: EWorkerImage,
  profile: WorkerContainerResourceProfile = 'active'
): IWorkerContainerResourcePolicy | null {
  const defaults =
    profile === 'warm'
      ? WARM_DEFAULTS_BY_IMAGE[image]
      : DEFAULTS_BY_IMAGE[image];
  const suffix = ENV_SUFFIX_BY_IMAGE[image];
  if (!defaults || !suffix) {
    return null;
  }
  if (!parseBoolean('WORKER_CONTAINER_RESOURCE_LIMITS_ENABLED', true)) {
    return null;
  }

  const environmentPrefix =
    profile === 'warm'
      ? `WORKER_CONTAINER_WARM_${suffix}`
      : `WORKER_CONTAINER_${suffix}`;
  const memoryMb = parseBoundedInteger(
    `${environmentPrefix}_MEMORY_MB`,
    defaults.memoryMb,
    profile === 'warm' ? 128 : 256,
    16_384
  );
  const cpuMillis = parseBoundedInteger(
    `${environmentPrefix}_CPU_MILLIS`,
    defaults.cpuMillis,
    250,
    8_000
  );
  const pidsLimit =
    profile === 'warm'
      ? parseBoundedInteger(
          `${environmentPrefix}_PIDS_LIMIT`,
          defaults.pidsLimit,
          64,
          4_096
        )
      : parseBoundedInteger(
          'WORKER_CONTAINER_PIDS_LIMIT',
          defaults.pidsLimit,
          64,
          4_096
        );
  const memoryBytes = memoryMb * MEBIBYTE;
  const memoryReservationBytes = Math.max(
    128 * MEBIBYTE,
    Math.floor(memoryBytes / 2)
  );
  const nanoCpus = Math.floor((cpuMillis / 1_000) * NANO_CPUS_PER_CPU);

  return {
    image,
    profile,
    hostConfig: {
      Memory: memoryBytes,
      MemoryReservation: memoryReservationBytes,
      /*
       * Equal Memory and MemorySwap means no additional anonymous swap. A
       * single stalled provider is restarted inside its own boundary instead
       * of swapping every realtime channel on the host.
       */
      MemorySwap: memoryBytes,
      NanoCpus: nanoCpus,
      OomKillDisable: false,
      /*
       * Keep the host and Balance control plane preferable to every worker
       * during unavoidable global pressure. Warm standbys are reconstructible
       * and therefore intentionally more disposable than serving channels.
       */
      OomScoreAdj: profile === 'warm' ? 750 : 250,
      PidsLimit: pidsLimit,
    },
    labels: {
      'underchat.resource_policy': 'v2',
      'underchat.resource_profile': profile,
      'underchat.resource_memory_bytes': String(memoryBytes),
      'underchat.resource_memory_reservation_bytes': String(
        memoryReservationBytes
      ),
      'underchat.resource_memory_swap_bytes': String(memoryBytes),
      'underchat.resource_nano_cpus': String(nanoCpus),
      'underchat.resource_oom_kill_disable': 'false',
      'underchat.resource_oom_score_adj': String(
        profile === 'warm' ? 750 : 250
      ),
      'underchat.resource_pids_limit': String(pidsLimit),
    },
  };
}
