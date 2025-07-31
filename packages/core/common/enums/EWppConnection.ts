import { ECodeMessage } from './ECodeMessage';

export interface EWppConnection {
  worker_id: string;
  status: string | null;
  code: ECodeMessage | string | null;
  message: string | null;
  date: Date;
}
