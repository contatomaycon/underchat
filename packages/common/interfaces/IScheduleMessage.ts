import { IChatMessage } from './IChatMessage';

export interface IScheduleMessage {
  schedule_id: string;
  /** Unique operational identity for this delivery attempt. */
  attempt_id?: string;
  account_id?: string;
  contact_id: string;
  message: IChatMessage;
  is_validated: boolean;
}
