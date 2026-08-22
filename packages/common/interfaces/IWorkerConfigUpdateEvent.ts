export interface IWorkerConfigUpdateEvent {
  worker_id: string;
  reject_call: boolean | null;
  revision?: string;
}
