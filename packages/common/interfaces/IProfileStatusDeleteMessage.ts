export interface IProfileStatusDeleteMessage {
  worker_id: string;
  account_id: string;
  worker_profile_status_id: string;
  external_id: string;
  statusJidList?: string[];
}
