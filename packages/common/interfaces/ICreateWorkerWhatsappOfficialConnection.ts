import { EWorkerStatus } from '../enums/EWorkerStatus';
import { EWorkerType } from '../enums/EWorkerType';

export interface ICreateWorkerWhatsappOfficialConnection {
  worker_whatsapp_official_connection_id: string;
  worker_id: string;
  account_id: string;
  server_id: string | null;
  worker_status_id: EWorkerStatus;
  worker_type_id: EWorkerType;
  name: string;
  number: string | null;
  connection_date: string;
  business_id?: string | null;
  waba_id: string;
  phone_number_id: string;
  display_phone_number?: string | null;
  verified_name?: string | null;
  access_token_encrypted: string;
  token_type?: string | null;
  expires_at?: string | null;
  scope?: string | null;
  api_version: string;
  connected_at: string;
}
