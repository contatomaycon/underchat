export interface IUserPhoneJidUpdate {
  user_id: string;
  phone_jid: string;
  account_id?: string;
  worker_id?: string;
  operation_id?: string;
  event_id?: string;
  source_provider?: string;
  runtime_generation?: number | string;
  connection_epoch?: string;
}
