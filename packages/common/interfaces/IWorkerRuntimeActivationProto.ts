export interface IWorkerRuntimeActivationRequestProto {
  worker_id?: string;
  account_id?: string;
  worker_type_id?: string;
  warm_pool_id?: string;
  session_volume_name?: string;
  balancer_grpc_host?: string;
  balancer_grpc_port?: number | string;
  runtime_generation?: number | string;
}

export interface IWorkerRuntimeActivationResponseProto {
  worker_id?: string;
  account_id?: string;
  activated?: boolean;
  already_active?: boolean;
  error?: string;
}

export interface IWorkerRuntimeHealthRequestProto {
  worker_id?: string;
  warm_pool_id?: string;
}

export interface IWorkerRuntimeHealthResponseProto {
  worker_id?: string;
  account_id?: string;
  warm_pool_id?: string;
  standby?: boolean;
  activated?: boolean;
  ready?: boolean;
  has_session?: boolean;
  has_qr?: boolean;
  error?: string;
  worker_type_id?: string;
  runtime_generation?: number | string;
  runtime_state?: string;
  qr_stream_ready?: boolean;
  session_ready?: boolean;
  can_send?: boolean;
  can_receive_runtime?: boolean;
  authenticated?: boolean;
  provider_state?: string;
  degraded_reason?: string;
  last_probe_at?: string;
  probe_latency_ms?: number | string;
}
