import { IUpsertMessage } from './IUpsertMessage';

export interface IBaileysPendingMessage {
  inputUpsert: IUpsertMessage;
  messageKey: string;
  kafkaKey?: string;
  topic: string;
  retries: number;
  addedAt: number;
}
