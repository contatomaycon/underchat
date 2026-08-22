export interface IWorkerSelfHealingRequestProto {
  worker_id?: string;
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
  runtime_generation?: number | string;
  debug_trace_id?: string;
  recovery_window_seconds?: number | string;
}
