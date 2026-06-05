export interface IWorkerRuntime {
  worker_id: string;
  container_id?: string | null;
  container_name?: string | null;
  session_volume_name: string;
  runtime_generation: number;
  warm_pool_id?: string | null;
  activated_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}
