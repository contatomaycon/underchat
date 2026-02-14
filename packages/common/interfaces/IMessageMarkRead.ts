import type { IUpsertMessageKey } from './IUpsertMessage';

export interface IMessageMarkRead {
  account_id: string;
  worker_id: string;
  keys: IUpsertMessageKey[];
}
