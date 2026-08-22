export interface IUpdateProfileStatusExternalId {
  worker_profile_status_id: string;
  external_id: string;
  event_id?: string;
  account_id?: string;
  worker_id?: string;
  source_provider?: string;
  runtime_generation?: number;
  connection_epoch?: string;
}
