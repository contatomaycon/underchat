export enum EServerBuildJobStatus {
  queued = 'queued',
  running = 'running',
  cancel_requested = 'cancel_requested',
  canceled = 'canceled',
  failed = 'failed',
  completed = 'completed',
}
