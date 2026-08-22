export interface IPhoneValidationResponse {
  request_id: string;
  account_id: string;
  worker_id: string;
  valid: boolean;
  jid?: string | null;
  phone?: string | null;
  error?: string | null;
  source_provider?: string;
  runtime_generation?: number;
  connection_epoch?: string;
}
