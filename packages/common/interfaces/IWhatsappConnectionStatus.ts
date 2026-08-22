import { EWhatsappConnectionStatus } from '../enums/EWhatsappConnectionStatus';

export type WhatsappConnectionStatusProvider =
  'baileys' | 'wwebjs' | 'whatsmeow';

/**
 * Provider-owned, secret-free connection state shared by all WhatsApp
 * runtimes. `sequence` starts at one and is monotonic for the lifetime of one
 * native client.
 */
export interface IWhatsappConnectionStatus {
  provider: WhatsappConnectionStatusProvider;
  status: EWhatsappConnectionStatus;
  connected: boolean;
  authenticated: boolean;
  sessionValid: boolean | null;
  recoverable: boolean;
  qrAvailable: boolean;
  sequence: number;
  changedAt: string;
  reason?: string;
  errorCode?: string;
}

export interface IWhatsappConnectionStatusSource {
  getConnectionStatus(): unknown;
}

export interface IWhatsappConnectionStatusEventSource extends IWhatsappConnectionStatusSource {
  on(
    event: 'connection_status',
    listener: (snapshot: unknown) => void
  ): unknown;
}
