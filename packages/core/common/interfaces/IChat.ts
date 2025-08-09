import { EChatStatus } from '../enums/EChatStatus';

export interface ISummary {
  last_message: string;
  last_date: Date;
  unread_count: number;
}

export interface IAccount {
  id: string;
  name: string;
}

export interface IWorker {
  id: string;
  name: string;
}

export interface ISector {
  id: string;
  name: string;
}

export interface IUser {
  id: string;
  name: string;
  photo: string | null;
}

export interface IContact {
  id: string;
  name: string;
  phone: string;
}

export interface IChat {
  chat_id: string;
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
