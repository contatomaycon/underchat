export interface IWorkerWarmReplenishRequest {
  request_id: string;
  server_id: string;
  worker_type_id: string;
  reason: 'scheduled_scan' | 'claim_replenish' | 'pool_miss' | 'manual';
  requested_at: string;
}

export interface IWorkerWarmDeleteRequest {
  request_id: string;
  warm_pool_id?: string;
  worker_id?: string;
  server_id: string;
  worker_type_id?: string;
  container_id?: string | null;
  container_name?: string | null;
  session_volume_name?: string | null;
  remove_volume: boolean;
  reason:
    | 'assigned_old_runtime'
    | 'expired_reservation'
    | 'pool_reconcile'
    | 'worker_delete'
    | 'worker_type_change'
    | 'reset_session'
    | 'manual';
  requested_at: string;
}
