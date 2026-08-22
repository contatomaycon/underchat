import type { WorkerCommandBus } from '@core/common/interfaces/IWorkerCommandBus';
import type {
  WorkerCommandEnvelopeV1,
  WorkerCommandPublishReceiptV1,
} from '@core/common/interfaces/IWorkerCommandEnvelope';
import { NatsJetStreamPublisher } from '@core/services/natsJetStreamPublisher.service';

export class JetStreamWorkerCommandBus implements WorkerCommandBus {
  constructor(private readonly publisher: NatsJetStreamPublisher) {}

  publish(
    envelope: WorkerCommandEnvelopeV1
  ): Promise<WorkerCommandPublishReceiptV1> {
    return this.publisher.publishCommand(envelope);
  }

  retry(
    envelope: WorkerCommandEnvelopeV1
  ): Promise<WorkerCommandPublishReceiptV1> {
    return this.publisher.retryCommand(envelope);
  }

  close(): Promise<void> {
    return this.publisher.close();
  }
}
