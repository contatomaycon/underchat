import { IPendingMessage } from './IPendingMessage';

export interface IPendingMessageWithTimestamp extends IPendingMessage {
  timeoutFired: boolean;
}
