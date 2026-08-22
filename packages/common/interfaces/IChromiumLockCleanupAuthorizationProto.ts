export interface IChromiumLockCleanupAuthorizationRequestProto {
  request_id?: string;
  worker_id?: string;
  account_id?: string;
  worker_type_id?: string;
  runtime_generation?: number | string;
  requester_container_id?: string;
  session_volume_name?: string;
  singleton_lock_target?: string;
}

export interface IChromiumLockCleanupAuthorizationResponseProto {
  authorized?: boolean;
  reason?: string;
  request_id?: string;
  requester_container_id?: string;
  owner_container_id?: string;
  session_volume_name?: string;
  singleton_lock_target?: string;
  expires_at_unix_ms?: number | string;
}
