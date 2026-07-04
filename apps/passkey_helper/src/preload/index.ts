import { ipcRenderer } from 'electron';

import { installUnderchatPasskeyOverlay } from '../renderer/overlay';
import { getPasskeyAssertion } from './webauthn';

export interface PasskeyHelperSessionPayload {
  apiBaseUrl?: string;
  error?: string;
  session?: {
    channel_name?: string;
    channelName?: string;
    confirmationCode?: string;
    expires_at?: string;
    expiresAt?: string;
    passkey_confirmation_code?: string;
    passkey_public_key?: unknown;
    passkey_skip_handoff_ux?: boolean;
    passkeyPublicKey?: unknown;
    publicKey?: unknown;
    skipHandoffUX?: boolean;
    status?: number;
  };
  tokenHash?: string;
}

export interface PasskeyHelperActionResult {
  code?: number;
  confirmationCode?: string;
  connected?: boolean;
  message?: string;
  passkey_confirmation_code?: string;
  passkeyConfirmationCode?: string;
  passkey_skip_handoff_ux?: boolean;
  passkeySkipHandoffUX?: boolean;
  status?: number;
}

export interface UnderchatPasskeyBridge {
  confirmPasskey: () => Promise<PasskeyHelperActionResult>;
  getPasskeyAssertion: (publicKey: unknown) => Promise<unknown>;
  getSession: () => Promise<PasskeyHelperSessionPayload>;
  onSessionUpdated: (callback: () => void) => () => void;
  sendPasskeyResponse: (
    passkeyResponse: unknown
  ) => Promise<PasskeyHelperActionResult>;
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
};

window.addEventListener('DOMContentLoaded', () => {
  installUnderchatPasskeyOverlay(bridge);
});
