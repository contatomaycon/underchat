import { EWorkerAction } from '@core/common/enums/EWorkerAction';

export interface WorkerTopicLifecycleContext {
  worker_id: string;
  account_id: string;
  action: EWorkerAction;
  lifecycle_operation_id?: string;
  debug_trace_id?: string;
}

/**
 * A worker-topic mutation is authorized only while its distributed lifecycle
 * lease remains current. Keeping this as the smallest possible interface makes
 * it impossible for Kafka helpers to acquire or manufacture a lease.
 */
export interface WorkerTopicMutationLease {
  assertActive(): void;
}

export interface PermanentWorkerTopicDeletionRequest extends WorkerTopicLifecycleContext {
  action: EWorkerAction.delete;
  lifecycle_operation_id: string;
  debug_trace_id: string;
}

export interface PermanentWorkerDeletionIntentAuthorization {
  permanently_deleted: boolean;
}
