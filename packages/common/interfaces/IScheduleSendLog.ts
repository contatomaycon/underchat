import { WAMessage } from '@whiskeysockets/baileys';

export interface IScheduleSendLog {
  schedule_id: string;
  contact_id: string;
  message_id: string;
  result: WAMessage | null;
  error: string | null;
  success: boolean;
}
