export interface WorkerSelfHealRecoveryState {
  worker_id: string;
  account_id?: string;
  worker_type_id?: string;
  source?: string;
  reason?: string;
  provider_state?: string;
  degraded_reason?: string;
  kafka_unhealthy?: boolean;
  session_ready?: boolean;
  can_send?: boolean;
  can_receive_runtime?: boolean;
  authenticated?: boolean;
  phone?: string;
  runtime_generation?: number;
  operation_id?: string;
  requested_at: string;
  deadline_at: string;
  recovery_window_seconds: number;
  debug_trace_id?: string;
}

export const workerSelfHealInflightKey = (workerId: string): string =>
  `worker:self-heal:inflight:${workerId}`;

export const workerSelfHealCooldownKey = (workerId: string): string =>
  `worker:self-heal:cooldown:${workerId}`;

export const workerSelfHealRecoveryKey = (workerId: string): string =>
  `worker:self-heal:recovery:${workerId}`;

export const workerSelfHealDailyKey = (
  workerId: string,
  localDate: string,
  schedule?: string
): string => {
  const suffix = schedule?.trim() ? `:${schedule.trim()}` : '';
  return `worker:self-heal:daily:${workerId}:${localDate}${suffix}`;
};

export const workerRecreateServerSlotKey = (
  serverId: string,
  slot: number
): string => `worker:recreate:server:${serverId}:slot:${slot}`;

export function parseWorkerSelfHealRecoveryState(
  raw: string | null | undefined
): WorkerSelfHealRecoveryState | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<WorkerSelfHealRecoveryState>;
    if (!parsed.worker_id || !parsed.deadline_at) {
      return null;
    }

    return parsed as WorkerSelfHealRecoveryState;
  } catch {
    return null;
  }
}
