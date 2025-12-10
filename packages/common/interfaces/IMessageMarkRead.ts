import { WAMessageKey } from '@whiskeysockets/baileys';

export interface IMessageMarkRead {
  account_id: string;
  worker_id: string;
  keys: WAMessageKey[];
}
