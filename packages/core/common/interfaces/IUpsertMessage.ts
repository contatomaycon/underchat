import { WAMessage } from '@whiskeysockets/baileys';
import { EMessageType } from '../enums/EMessageType';

export interface IUpsertMessage {
  worker_id: string;
  account_id: string;
  type: EMessageType;
  message: WAMessage;
  photo?: string | null;
}
