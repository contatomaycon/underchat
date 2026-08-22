import { ITypingSimulationConfig } from '../interfaces/ITypingSimulationConfig';

export const DEFAULT_TYPING_SIMULATION_SPEED = 50;
export const DEFAULT_TYPING_SIMULATION_ENABLED = true;
export const DEFAULT_TYPING_SIMULATION_MAX_DELAY_MS = 15_000;
export const TYPING_SIMULATION_CACHE_TTL_SECONDS = 60 * 60 * 24 * 7;

export const defaultTypingSimulationConfig = (): ITypingSimulationConfig => ({
  enabled: DEFAULT_TYPING_SIMULATION_ENABLED,
  speed: DEFAULT_TYPING_SIMULATION_SPEED,
});

export const typingSimulationCacheKey = (workerId: string): string =>
  `worker:${workerId}:typing_simulation`;

export const isValidTypingSimulationSpeed = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= 100;

export const normalizeTypingSimulationSpeed = (value: unknown): number => {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number.parseInt(value, 10)
        : Number.NaN;

  if (!Number.isFinite(parsed)) {
    return DEFAULT_TYPING_SIMULATION_SPEED;
  }

  return Math.max(0, Math.min(100, Math.trunc(parsed)));
};

export const normalizeTypingSimulationConfig = (
  value: Partial<ITypingSimulationConfig> | null | undefined
): ITypingSimulationConfig => {
  if (!value) {
    return defaultTypingSimulationConfig();
  }

  return {
    enabled:
      typeof value.enabled === 'boolean'
        ? value.enabled
        : DEFAULT_TYPING_SIMULATION_ENABLED,
    speed: normalizeTypingSimulationSpeed(value.speed),
  };
};

export const parseTypingSimulationConfigCache = (
  value: string | null
): ITypingSimulationConfig | null => {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as Partial<ITypingSimulationConfig>;
    const speed = parsed.speed;

    if (typeof parsed.enabled !== 'boolean') {
      return null;
    }

    if (!isValidTypingSimulationSpeed(speed)) {
      return null;
    }

    return {
      enabled: parsed.enabled,
      speed,
    };
  } catch {
    return null;
  }
};

export const typingSimulationDelayMultiplier = (speed: number): number => {
  const normalizedSpeed = normalizeTypingSimulationSpeed(speed);
  const multiplier = 1 - normalizedSpeed / 100;

  return Math.max(0.15, Math.min(1, multiplier));
};

export const resolveTypingSimulationMaxDelayMs = (
  rawValue = process.env.TYPING_SIMULATION_MAX_DELAY_MS
): number => {
  const parsed = Number.parseInt(rawValue ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_TYPING_SIMULATION_MAX_DELAY_MS;
  }

  return Math.min(60_000, Math.max(1_000, parsed));
};
