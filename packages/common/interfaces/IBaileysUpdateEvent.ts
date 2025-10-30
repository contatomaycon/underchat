export interface IBaileysUpdateEvent {
  qr?: string;
  connection?: 'open' | 'close' | 'connecting' | 'disconnecting';
  lastDisconnect?: { error?: Error };
  isNewLogin?: boolean;
}
