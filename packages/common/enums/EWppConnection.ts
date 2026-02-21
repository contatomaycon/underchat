import { ECodeMessage } from './ECodeMessage';

export interface EWppConnection {
  worker_id: string;
  status: string | null;
  code: ECodeMessage | string | null;
  message: string | null;
  date: Date;
  phone?: string | null;
  connected_at?: Date | null;
}
