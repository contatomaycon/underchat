export interface IConfigChannelRecreateTarget {
  worker_id: string;
  worker_account_id: string;
  server_id: string;
  worker_type_id: string;
  worker_status_id: string;
  worker_container_id: string | null;
  runtime_container_id: string | null;
  runtime_generation: number | null;
}
