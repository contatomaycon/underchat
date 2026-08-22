export type SecureConnectionStatus =
  | 'created'
  | 'helper_opened'
  | 'wa_authenticated'
  | 'wa_syncing'
  | 'wa_ready'
  | 'uploading'
  | 'session_received'
  | 'importing'
  | 'validating_worker'
  | 'connected'
  | 'connected_confirmed'
  | 'failed'
  | 'expired'
  | 'cancelled';

export type {
  SecureConnectionTargetProvider,
  SecureSessionPackage,
} from '@underchat/whatsapp-web-session-browser';

export type SecureConnectionSessionResponse = {
  connection_attempt_id: string;
  error?: string;
  expires_at: string;
  helper_download_url?: string;
  message?: string;
  phone?: string;
  runtime_generation?: number;
  status: SecureConnectionStatus;
  token?: string;
  token_hash: string;
  worker_id: string;
  worker_type_id?: string;
};

export type PopupStatusTone = 'busy' | 'error' | 'success' | 'waiting';

export type PopupStepId =
  | 'whatsapp_open'
  | 'whatsapp_connected'
  | 'token_pasted'
  | 'session_imported'
  | 'local_cleanup';

export type PopupStepStatus = 'active' | 'done' | 'error' | 'pending';

export type PopupStepState = {
  id: PopupStepId;
  status: PopupStepStatus;
};

export type PopupConnectionState = {
  busy: boolean;
  message: string;
  steps?: PopupStepState[];
  tabReady: boolean;
  title: string;
  tone: PopupStatusTone;
};
