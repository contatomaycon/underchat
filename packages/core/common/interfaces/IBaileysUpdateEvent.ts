export interface IBaileysUpdateEvent {
  qr?: string;
  connection?: 'close' | 'connecting' | 'open';
  lastDisconnect?: { error?: Error };
}
