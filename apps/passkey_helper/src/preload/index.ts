import { ipcRenderer } from 'electron';

import { installUnderchatPasskeyOverlay } from '../renderer/overlay';
import { getPasskeyAssertion } from './webauthn';

export interface PasskeyHelperSessionPayload {
  apiBaseUrl?: string;
  error?: string;
  mode?: 'pair' | 'secure';
  session?: {
    channel_name?: string;
    channelName?: string;
    confirmationCode?: string;
    connection_attempt_id?: string;
    error?: string;
    expires_at?: string;
    expiresAt?: string;
    helper_download_url?: string;
    message?: string;
    passkey_confirmation_code?: string;
    passkey_public_key?: unknown;
    passkey_skip_handoff_ux?: boolean;
    passkeyPublicKey?: unknown;
    publicKey?: unknown;
    skipHandoffUX?: boolean;
    status?: number | string;
    token_hash?: string;
    worker_id?: string;
    worker_type_id?: string;
  };
  tokenHash?: string;
}

export interface PasskeyHelperActionResult {
  code?: number;
  confirmationCode?: string;
  connected?: boolean;
  error?: string;
  message?: string;
  passkey_confirmation_code?: string;
  passkeyConfirmationCode?: string;
  passkey_skip_handoff_ux?: boolean;
  passkeySkipHandoffUX?: boolean;
  status?: number | string;
}

export interface SecureSessionPackage {
  account_hint?: string;
  created_at: string;
  format_version: string;
  payload?: unknown;
  payload_ref?: string;
  source: 'whatsapp_web';
  target_provider: 'auto' | 'baileys' | 'wwebjs' | 'whatsmeow';
  web_version?: string;
}

export interface UnderchatPasskeyBridge {
  confirmPasskey: () => Promise<PasskeyHelperActionResult>;
  getPasskeyAssertion: (publicKey: unknown) => Promise<unknown>;
  getSession: () => Promise<PasskeyHelperSessionPayload>;
  onSessionUpdated: (callback: () => void) => () => void;
  sendPasskeyResponse: (
    passkeyResponse: unknown
  ) => Promise<PasskeyHelperActionResult>;
  sendSecureSessionPackage: (
    sessionPackage: SecureSessionPackage
  ) => Promise<PasskeyHelperActionResult>;
  updateSecureStatus: (statusPayload: {
    error?: string;
    message?: string;
    status: string;
  }) => Promise<PasskeyHelperActionResult>;
}

const bridge: UnderchatPasskeyBridge = {
  confirmPasskey: () =>
    ipcRenderer.invoke(
      'underchat-passkey:confirm'
    ) as Promise<PasskeyHelperActionResult>,
  getPasskeyAssertion,
  getSession: () =>
    ipcRenderer.invoke(
      'underchat-passkey:get-session'
    ) as Promise<PasskeyHelperSessionPayload>,
  onSessionUpdated: (callback) => {
    const listener = (): void => callback();

    ipcRenderer.on('underchat-passkey:session-updated', listener);

    return () => {
      ipcRenderer.removeListener('underchat-passkey:session-updated', listener);
    };
  },
  sendPasskeyResponse: (passkeyResponse) =>
    ipcRenderer.invoke(
      'underchat-passkey:send-response',
      passkeyResponse
    ) as Promise<PasskeyHelperActionResult>,
  sendSecureSessionPackage: (sessionPackage) =>
    ipcRenderer.invoke(
      'underchat-passkey:upload-secure-session',
      sessionPackage
    ) as Promise<PasskeyHelperActionResult>,
  updateSecureStatus: (statusPayload) =>
    ipcRenderer.invoke(
      'underchat-passkey:update-secure-status',
      statusPayload
    ) as Promise<PasskeyHelperActionResult>,
};

window.addEventListener('DOMContentLoaded', () => {
  installUnderchatPasskeyOverlay(bridge);
});
