import { MessageSummaryPatch } from '@core/services/messageStatus.service';
import { WAMessageKey } from '@whiskeysockets/baileys';

export interface IMessageStatusUpdate {
  account_id: string;
  message_id: string;
  patch: MessageSummaryPatch;
  key?: WAMessageKey;
}
