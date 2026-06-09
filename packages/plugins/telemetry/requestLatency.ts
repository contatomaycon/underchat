import { AsyncLocalStorage } from 'node:async_hooks';

export const MANAGER_SLOW_REQUEST_THRESHOLD_MS = 1500;

type StagePrimitive = string | number | boolean | null | undefined;

export type RequestLatencyStage = {
  name: string;
  duration_ms: number;
  ok: boolean;
} & Record<string, StagePrimitive>;

export type RequestLatencyContext = {
  stages: RequestLatencyStage[];
};

const requestLatencyStorage = new AsyncLocalStorage<RequestLatencyContext>();
const MAX_STAGE_COUNT = 80;
const MAX_STRING_LENGTH = 160;

export function createRequestLatencyContext(): RequestLatencyContext {
  return {
    stages: [],
  };
}

export function enterRequestLatencyContext(
  context: RequestLatencyContext
): void {
  requestLatencyStorage.enterWith(context);
}

export function runWithRequestLatencyContext<T>(
  context: RequestLatencyContext,
  callback: () => T
): T {
  return requestLatencyStorage.run(context, callback);
}

export function getRequestLatencyContext(): RequestLatencyContext | undefined {
  return requestLatencyStorage.getStore();
}

function sanitizeStageValue(value: unknown): StagePrimitive {
  if (value === null || value === undefined) {
    return value;
  }

  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'string'
  ) {
    if (typeof value === 'string' && value.length > MAX_STRING_LENGTH) {
      return value.slice(0, MAX_STRING_LENGTH);
    }

    return value;
  }

  return String(value).slice(0, MAX_STRING_LENGTH);
}

export function recordRequestLatencyStage(
  name: string,
  durationMs: number,
  attributes: Record<string, unknown> = {},
  ok = true
): void {
  const context = getRequestLatencyContext();
  if (!context || context.stages.length >= MAX_STAGE_COUNT) {
    return;
  }

  const sanitizedAttributes: Record<string, StagePrimitive> = {};
  for (const [key, value] of Object.entries(attributes)) {
    sanitizedAttributes[key] = sanitizeStageValue(value);
  }

  context.stages.push({
    name,
    duration_ms: Math.max(0, Math.round(durationMs)),
    ok,
    ...sanitizedAttributes,
  });
}

export async function measureRequestLatencyStage<T>(
  name: string,
  callback: () => Promise<T>,
  attributes: Record<string, unknown> = {}
): Promise<T> {
  const start = Date.now();

  try {
    const result = await callback();
    recordRequestLatencyStage(name, Date.now() - start, attributes, true);
    return result;
  } catch (error) {
    recordRequestLatencyStage(
      name,
      Date.now() - start,
      {
        ...attributes,
        error: error instanceof Error ? error.message : String(error),
      },
      false
    );
    throw error;
  }
}
