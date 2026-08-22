import type { WorkerCommandBus } from '@core/common/interfaces/IWorkerCommandBus';
import { JetStreamWorkerCommandBus } from '@core/services/jetStreamWorkerCommandBus.service';
import { NatsJetStreamPublisher } from '@core/services/natsJetStreamPublisher.service';

export const WORKER_COMMAND_TRANSPORT_JETSTREAM = 'jetstream' as const;
export type WorkerCommandTransport = typeof WORKER_COMMAND_TRANSPORT_JETSTREAM;

export class WorkerCommandTransportConfigurationError extends Error {
  constructor(readonly configuredValue: string) {
    super(
      `WORKER_COMMAND_TRANSPORT=${configuredValue || '<vazio>'} nao e suportado; use jetstream`
    );
    this.name = 'WorkerCommandTransportConfigurationError';
  }
}

export function resolveWorkerCommandTransport(
  configuredValue: string | undefined
): WorkerCommandTransport {
  const normalized = configuredValue?.trim().toLowerCase();
  if (normalized === undefined || normalized === '') {
    return WORKER_COMMAND_TRANSPORT_JETSTREAM;
  }
  if (normalized !== WORKER_COMMAND_TRANSPORT_JETSTREAM) {
    throw new WorkerCommandTransportConfigurationError(configuredValue ?? '');
  }
  return WORKER_COMMAND_TRANSPORT_JETSTREAM;
}

export interface CreateWorkerCommandBusOptions {
  environment?: NodeJS.ProcessEnv;
  publisher?: NatsJetStreamPublisher;
}

export function createWorkerCommandBus(
  options: CreateWorkerCommandBusOptions = {}
): WorkerCommandBus {
  const environment = options.environment ?? process.env;
  resolveWorkerCommandTransport(environment.WORKER_COMMAND_TRANSPORT);
  const publisher =
    options.publisher ?? NatsJetStreamPublisher.fromEnvironment(environment);
  return new JetStreamWorkerCommandBus(publisher);
}
