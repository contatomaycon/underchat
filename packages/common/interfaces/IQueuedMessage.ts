import type { MessageHeader } from 'node-rdkafka';

export interface IQueuedMessage {
  topic: string;
  value: Buffer;
  keyBuffer: Buffer | undefined;
  headers?: MessageHeader[];
  resolve: () => void;
  reject: (error: Error) => void;
}
