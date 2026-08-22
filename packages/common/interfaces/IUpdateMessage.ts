import { proto, WAMessage } from '@whiskeysockets/baileys';
import { IChatMessage } from './IChatMessage';
import { IMessageKeyResponse } from './IMessageKeyResponse';
import { WhatsAppSourceProvider } from './IUpsertMessage';

export interface IUpdateMessage {
  /** Stable identity of this logical message update operation. */
  event_id?: string;
  worker_id?: string;
  source_provider?: WhatsAppSourceProvider;
  runtime_generation?: number | string;
  connection_epoch?: string;
  message: proto.WebMessageInfo | WAMessage | IMessageKeyResponse | undefined;
  data: IChatMessage;
}
