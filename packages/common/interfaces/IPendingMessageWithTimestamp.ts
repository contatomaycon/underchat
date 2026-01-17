import { IPendingMessage } from './IPendingMessage';

export interface IPendingMessageWithTimestamp extends IPendingMessage {
  startTime: number;
  timeoutFired: boolean;
}
