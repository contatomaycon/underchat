export interface ICreateWarmWorkerRequestProto {
  request_id?: string;
  warm_pool_id?: string;
  server_id?: string;
  worker_type_id?: string;
}

export interface IDeleteWarmWorkerRequestProto {
  request_id?: string;
  warm_pool_id?: string;
  worker_id?: string;
  server_id?: string;
  worker_type_id?: string;
  container_id?: string;
  container_name?: string;
  session_volume_name?: string;
  remove_volume?: boolean;
  reason?: string;
  requested_at?: string;
}

export interface IActivateWarmWorkerRequestProto {
  warm_pool_id?: string;
  worker_id?: string;
  account_id?: string;
  server_id?: string;
  worker_type_id?: string;
}

export interface IWarmWorkerCommandResponseProto {
  warm_pool_id?: string;
  worker_id?: string;
  container_id?: string;
  container_name?: string;
  session_volume_name?: string;
  claimed?: boolean;
  fallback_created?: boolean;
  error?: string;
}
