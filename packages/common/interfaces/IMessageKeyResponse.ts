export interface IMessageKeyResponse {
  key: {
    id: string;
    remoteJid?: string;
    remote_jid?: string;
    fromMe?: boolean;
    from_me?: boolean;
    participant?: string;
  };
}
