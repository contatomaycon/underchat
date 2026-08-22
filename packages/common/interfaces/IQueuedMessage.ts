import type { MessageHeader } from 'node-rdkafka';

export interface IQueuedMessage {
  topic: string;
  value: Buffer;
  keyBuffer: Buffer | undefined;
  headers?: MessageHeader[];
  assertActive?: () => void | Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
}
