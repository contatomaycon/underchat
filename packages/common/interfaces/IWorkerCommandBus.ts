import type {
  WorkerCommandEnvelopeV1,
  WorkerCommandPublishReceiptV1,
} from '@core/common/interfaces/IWorkerCommandEnvelope';

export const WORKER_COMMAND_BUS_TOKEN = Symbol.for(
  'underchat.WorkerCommandBus'
);

export interface WorkerCommandBus {
  publish(
    envelope: WorkerCommandEnvelopeV1
  ): Promise<WorkerCommandPublishReceiptV1>;
  retry(
    envelope: WorkerCommandEnvelopeV1
  ): Promise<WorkerCommandPublishReceiptV1>;
  close(): Promise<void>;
}
