export interface IQueuedMessage {
  topic: string;
  value: Buffer;
  keyBuffer: Buffer | undefined;
  resolve: () => void;
  reject: (error: Error) => void;
}
