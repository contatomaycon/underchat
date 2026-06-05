export interface ICreateWorkerResponse {
  worker_id: string;
  server_id: string;
  worker_type_id: string;
  warm_pool_claimed?: boolean;
  warm_pool_id?: string;
  fallback_created?: boolean;
}
