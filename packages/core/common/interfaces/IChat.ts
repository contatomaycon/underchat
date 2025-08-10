import { EChatStatus } from '../enums/EChatStatus';

interface ISummary {
  last_message: string;
  last_date: Date;
  unread_count: number;
}

interface IAccount {
  id: string;
  name: string;
}

interface IWorker {
  id: string;
  name: string;
}

interface ISector {
  id: string;
  name: string;
}

interface IUser {
  id: string;
  name: string;
  photo: string | null;
}

interface IContact {
  id: string;
  name: string;
  phone: string;
}

interface IMessageKey {
  id?: string | null;
  jid?: string | null;
}

export interface IChat {
  chat_id: string;
  message_key?: IMessageKey | null;
  summary: ISummary;
  account: IAccount;
  worker: IWorker;
  sector: ISector | null;
  user: IUser | null;
  contact: IContact | null;
  photo: string | null;
  name: string | null;
  phone: string;
  status: EChatStatus;
  date: string;
}
