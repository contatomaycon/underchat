import { EWorkerType } from '../enums/EWorkerType';

export const SECURE_CONNECTION_STATUSES = [
  'created',
  'helper_opened',
  'wa_authenticated',
  'wa_syncing',
  'wa_ready',
  'uploading',
  'session_received',
  'importing',
  'validating_worker',
  'connected',
  'connected_confirmed',
  'failed',
  'expired',
  'cancelled',
] as const;

export type SecureConnectionStatus =
  (typeof SECURE_CONNECTION_STATUSES)[number];

export type SecureConnectionTargetProvider =
  'auto' | 'baileys' | 'wwebjs' | 'whatsmeow';

export interface ISecureConnectionSession {
  account_id: string;
  worker_id: string;
  server_id?: string;
  worker_type_id?: EWorkerType;
  worker_status_id?: string;
  token: string;
  token_hash: string;
  deep_link: string;
  status: SecureConnectionStatus;
  connection_attempt_id: string;
  /**
   * One-shot manager authorization for replacing the connection epoch after
   * an explicit session removal. It is kept server-side and consumed by the
   * worker before any imported session record is written.
   */
  authorized_connection_epoch?: string;
  runtime_generation?: number;
  helper_version?: string;
  helper_platform?: string;
  error?: string;
  fail_reason?: string;
  created_at: string;
  updated_at: string;
  expires_at: string;
  upload_received_at?: string;
  imported_at?: string;
  phone?: string;
}

export interface ISecureConnectionSessionPublicView {
  token_hash: string;
  status: SecureConnectionStatus;
  channel_name?: string;
  worker_id: string;
  worker_type_id?: EWorkerType;
  connection_attempt_id: string;
  expires_at: string;
  helper_download_url?: string;
  message?: string;
}

export interface ISecureConnectionSessionPackage {
  format_version: string;
  source: 'whatsapp_web';
  target_provider: SecureConnectionTargetProvider;
  created_at: string;
  web_version?: string;
  account_hint?: string;
  checksum?: string;
  payload?: unknown;
  payload_ref?: string;
}

export interface ISecureConnectionImportRequest {
  worker_id: string;
  account_id: string;
  worker_type_id?: EWorkerType;
  connection_attempt_id: string;
  authorized_connection_epoch?: string;
  runtime_generation?: number;
  format_version: string;
  source: 'whatsapp_web';
  target_provider: SecureConnectionTargetProvider;
  payload_ref?: string;
  payload_json?: string;
  checksum?: string;
  debug_trace_id?: string;
}
