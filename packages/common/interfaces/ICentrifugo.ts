import { PublishResult } from 'centrifuge';

export type ICentrifugoPublishGuard = () => void | Promise<void>;

export interface IQueuedPublish {
  channel: string;
  data: unknown;
  timestamp: number;
  idempotencyKey?: string;
  assertActive?: ICentrifugoPublishGuard;
  resolve: (result: PublishResult) => void;
  reject: (error: Error) => void;
}

export interface ICachedPublish {
  channel: string;
  data: unknown;
  timestamp: number;
  hash: string;
}
