import { EWorkerSessionStorage } from '../enums/EWorkerSessionStorage';

export interface IViewWorkerType {
  worker_id: string;
  worker_type_id: string;
  session_storage?: EWorkerSessionStorage;
}
