import { PublishResult } from 'centrifuge';

export interface IQueuedPublish {
  channel: string;
  data: unknown;
  timestamp: number;
  resolve: (result: PublishResult) => void;
  reject: (error: Error) => void;
}

export interface ICachedPublish {
  channel: string;
  data: unknown;
  timestamp: number;
  hash: string;
}
