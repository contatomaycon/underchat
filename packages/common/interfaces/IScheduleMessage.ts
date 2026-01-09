import { IChatMessage } from './IChatMessage';

export interface IScheduleMessage {
  schedule_id: string;
  contact_id: string;
  message: IChatMessage;
  is_validated: boolean;
}
