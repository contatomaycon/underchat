export interface IBaileysUpdateEvent {
  qr?: string;
  connection?: 'open' | 'close' | 'connecting' | 'disconnecting';
  lastDisconnect?: { error?: Error };
  isNewLogin?: boolean;
  passkey?: {
    publicKey?: unknown;
    confirmationCode?: string;
    skipHandoffUX?: boolean;
    error?: string;
    continuation?: boolean;
  };
}
