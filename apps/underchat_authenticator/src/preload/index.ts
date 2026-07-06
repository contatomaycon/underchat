import { ipcRenderer } from 'electron';

import { installUnderchatAuthenticatorOverlay } from '../renderer/overlay';

export interface AuthenticatorSessionPayload {
  apiBaseUrl?: string;
  error?: string;
  mode?: 'secure';
  session?: {
    channel_name?: string;
    channelName?: string;
    connection_attempt_id?: string;
    error?: string;
    expires_at?: string;
    expiresAt?: string;
    message?: string;
    status?: number | string;
    token_hash?: string;
    worker_id?: string;
    worker_type_id?: string;
  };
  tokenHash?: string;
}

export interface AuthenticatorActionResult {
  connected?: boolean;
  error?: string;
  message?: string;
  status?: number | string;
}

export interface AuthenticatorDiagnosticsInfo {
  channel: string;
  enabled: boolean;
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

export interface UnderchatAuthenticatorBridge {
  appendDebugLog: (
    event: string,
    details?: Record<string, unknown>
  ) => Promise<AuthenticatorActionResult>;
  closeHelper: () => Promise<AuthenticatorActionResult>;
  downloadDebugLog: () => Promise<AuthenticatorActionResult>;
  extractWhatsAppWebAuthDump: () => Promise<unknown>;
  getDiagnosticsInfo: () => Promise<AuthenticatorDiagnosticsInfo>;
  getSession: () => Promise<AuthenticatorSessionPayload>;
  onSessionUpdated: (callback: () => void) => () => void;
  sendSecureSessionPackage: (
    sessionPackage: SecureSessionPackage
  ) => Promise<AuthenticatorActionResult>;
  startControlledBrowser: () => Promise<AuthenticatorActionResult>;
  updateSecureStatus: (statusPayload: {
    error?: string;
    message?: string;
    status: string;
  }) => Promise<AuthenticatorActionResult>;
}

const bridge: UnderchatAuthenticatorBridge = {
  appendDebugLog: (event, details = {}) =>
    ipcRenderer.invoke('underchat-authenticator:append-debug-log', {
      details,
      event,
    }) as Promise<AuthenticatorActionResult>,
  closeHelper: () =>
    ipcRenderer.invoke(
      'underchat-authenticator:close-helper'
    ) as Promise<AuthenticatorActionResult>,
  downloadDebugLog: () =>
    ipcRenderer.invoke(
      'underchat-authenticator:download-debug-log'
    ) as Promise<AuthenticatorActionResult>,
  extractWhatsAppWebAuthDump: () =>
    ipcRenderer.invoke(
      'underchat-authenticator:extract-wa-auth-dump'
    ) as Promise<unknown>,
  getDiagnosticsInfo: () =>
    ipcRenderer.invoke(
      'underchat-authenticator:get-diagnostics-info'
    ) as Promise<AuthenticatorDiagnosticsInfo>,
  getSession: () =>
    ipcRenderer.invoke(
      'underchat-authenticator:get-session'
    ) as Promise<AuthenticatorSessionPayload>,
  onSessionUpdated: (callback) => {
    const listener = (): void => callback();

    ipcRenderer.on('underchat-authenticator:session-updated', listener);

    return () => {
      ipcRenderer.removeListener(
        'underchat-authenticator:session-updated',
        listener
      );
    };
  },
  sendSecureSessionPackage: (sessionPackage) =>
    ipcRenderer.invoke(
      'underchat-authenticator:upload-secure-session',
      sessionPackage
    ) as Promise<AuthenticatorActionResult>,
  startControlledBrowser: () =>
    ipcRenderer.invoke(
      'underchat-authenticator:start-controlled-browser'
    ) as Promise<AuthenticatorActionResult>,
  updateSecureStatus: (statusPayload) =>
    ipcRenderer.invoke(
      'underchat-authenticator:update-secure-status',
      statusPayload
    ) as Promise<AuthenticatorActionResult>,
};

window.addEventListener('DOMContentLoaded', () => {
  installUnderchatAuthenticatorOverlay(bridge);
});
