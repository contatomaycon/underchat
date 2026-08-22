import Redis from 'ioredis';
import { inject, singleton } from 'tsyringe';

const REGISTER_CURRENT_REVISION_SCRIPT = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0') or 0
local incoming = tonumber(ARGV[1]) or 0
if incoming <= 0 or incoming < current then
  return 0
end
if incoming > current then
  redis.call('SET', KEYS[1], ARGV[1])
end
return 1
`;

const IS_CURRENT_REVISION_SCRIPT = `
local current_raw = redis.call('GET', KEYS[1])
local incoming_raw = ARGV[1]

if incoming_raw == '' then
  if current_raw == false and redis.call('EXISTS', KEYS[2]) == 0 then
    return 1
  end
  return 0
end

if current_raw == false then
  return 0
end

local current = tonumber(current_raw)
local incoming = tonumber(incoming_raw)
return incoming ~= nil and incoming > 0 and current == incoming and 1 or 0
`;

@singleton()
export class WorkerConfigRevisionService {
  private static readonly keyPrefix = 'worker-config:revision:v1';

  constructor(@inject('Redis') private readonly redis: Redis) {}

  static currentKey(workerId: string): string {
    return `${WorkerConfigRevisionService.keyPrefix}:${workerId}:current`;
  }

  static legacyAppliedKey(workerId: string): string {
    return `${WorkerConfigRevisionService.keyPrefix}:${workerId}:applied`;
  }

  async registerCurrent(workerId: string, revision: string): Promise<void> {
    const normalizedWorkerId = this.normalizeWorkerId(workerId);
    const normalizedRevision = this.normalizeRevision(revision);
    const result = await this.redis.eval(
      REGISTER_CURRENT_REVISION_SCRIPT,
      1,
      WorkerConfigRevisionService.currentKey(normalizedWorkerId),
      normalizedRevision
    );
    if (Number(result) !== 1) {
      throw new Error('worker_config_revision_regression');
    }
  }

  async isCurrent(workerId: string, revision?: string): Promise<boolean> {
    const normalizedWorkerId = this.normalizeWorkerId(workerId);
    const rawRevision = revision?.trim() ?? '';
    const normalizedRevision = this.optionalRevision(rawRevision);
    if (rawRevision && !normalizedRevision) {
      return false;
    }

    const result = await this.redis.eval(
      IS_CURRENT_REVISION_SCRIPT,
      2,
      WorkerConfigRevisionService.currentKey(normalizedWorkerId),
      WorkerConfigRevisionService.legacyAppliedKey(normalizedWorkerId),
      normalizedRevision ?? ''
    );
    return Number(result) === 1;
  }

  private normalizeWorkerId(workerId: string): string {
    const normalized = workerId.trim();
    if (!normalized) {
      throw new TypeError('worker_id is required for worker config revision');
    }
    return normalized;
  }

  private normalizeRevision(revision: string): string {
    const normalized = this.optionalRevision(revision);
    if (!normalized) {
      throw new TypeError('Invalid worker config revision');
    }
    return normalized;
  }

  private optionalRevision(revision?: string): string | null {
    const normalized = revision?.trim();
    if (!normalized || !/^[1-9]\d*$/.test(normalized)) {
      return null;
    }
    try {
      const numeric = BigInt(normalized);
      if (numeric <= 0n || numeric > BigInt(Number.MAX_SAFE_INTEGER)) {
        return null;
      }
      return numeric.toString();
    } catch {
      return null;
    }
  }
}
