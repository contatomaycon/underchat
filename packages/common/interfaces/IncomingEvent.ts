import {
  MessageUpsertType,
  proto,
  WAMessage,
  WAMessageKey,
} from '@whiskeysockets/baileys';

export type IncomingEvent =
  | {
      type: 'message';
      data: { upsertType: MessageUpsertType; message: WAMessage };
    }
  | {
      type: 'message.update';
      data: { key: WAMessageKey; update: Partial<WAMessage> };
    }
  | {
      type: 'message.receipt';
      data: { key: WAMessageKey; receipt: proto.IUserReceipt };
    }
  | { type: 'presence.update'; data: any }
  | { type: 'messages.history'; data: any };
