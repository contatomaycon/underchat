import type { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { MessageSendConsume } from '@core/consumer/message/MessageSend.consume';
import { NotificationMessageSendConsume } from '@core/consumer/notification/NotificationMessageSend.consume';
import { ScheduleMessageConsume } from '@core/consumer/schedule/ScheduleMessage.consume';
import { WebhookIntegrationConsume } from '@core/consumer/webhook/WebhookIntegration.consume';
import { MessageMarkReadConsume } from '@core/consumer/worker/MessageMarkRead.consume';
import { WorkerConfigUpdateConsume } from '@core/consumer/worker/WorkerConfigUpdate.consume';
import { baileysEnvironment } from '@core/config/environments';
import { WorkerCommandEpochService } from '@core/services/workerCommandEpoch.service';
import {
  WorkerCommandJetStreamIngressService,
  type WorkerCommandIngressHandlerInput,
} from '@core/services/workerCommandJetStreamIngress.service';
import { WorkerCommandLaneService } from '@core/services/workerCommandLane.service';

function requireRuntimeWriterEpoch(): string {
  const writerEpoch = process.env.WORKER_WRITER_EPOCH?.trim();
  if (!writerEpoch) {
    throw new Error('worker_command_runtime_writer_epoch_required');
  }
  return writerEpoch;
}

function requireRuntimeGeneration(): number {
  const runtimeGeneration = Number(baileysEnvironment.runtimeGeneration);
  if (!Number.isSafeInteger(runtimeGeneration) || runtimeGeneration <= 0) {
    throw new Error('worker_command_runtime_generation_required');
  }
  return runtimeGeneration;
}

export async function startWorkerCommandIngressConsume(
  server: FastifyInstance,
  onCreated?: (consumer: WorkerCommandJetStreamIngressService) => void
): Promise<WorkerCommandJetStreamIngressService> {
  const messageSend = container.resolve(MessageSendConsume);
  const markRead = container.resolve(MessageMarkReadConsume);
  const notificationSend = container.resolve(NotificationMessageSendConsume);
  const scheduleSend = container.resolve(ScheduleMessageConsume);
  const workerConfig = container.resolve(WorkerConfigUpdateConsume);
  const webhookIntegration = container.resolve(WebhookIntegrationConsume);

  const handleProviderCommand = (input: WorkerCommandIngressHandlerInput) =>
    messageSend.handleJetStreamCommand(input);
  const ingress = new WorkerCommandJetStreamIngressService(
    {
      accountId: baileysEnvironment.baileysAccountId,
      workerId: baileysEnvironment.baileysWorkerId,
      runtimeWriterEpoch: requireRuntimeWriterEpoch(),
      runtimeGeneration: requireRuntimeGeneration(),
      handlers: {
        direct_send: handleProviderCommand,
        provider_command: handleProviderCommand,
        schedule_send: ({ operationId, payload, assertActive }) =>
          scheduleSend.handleJetStreamCommand(
            payload,
            assertActive,
            operationId
          ),
        notification_send: ({ operationId, payload, assertActive }) =>
          notificationSend.handleJetStreamCommand(
            payload,
            assertActive,
            operationId
          ),
        mark_read: ({ payload, assertActive }) =>
          markRead.handleJetStreamCommand(payload, assertActive),
        worker_config: ({ payload, assertActive }) =>
          workerConfig.handleJetStreamCommand(payload, assertActive),
        webhook_integration: ({ commandId, payload, assertActive }) =>
          webhookIntegration.handleJetStreamCommand(
            commandId,
            payload,
            assertActive
          ),
      },
    },
    container.resolve(WorkerCommandEpochService),
    container.resolve(WorkerCommandLaneService)
  );
  onCreated?.(ingress);

  try {
    await ingress.execute();
  } catch (error) {
    server.log.error(
      { err: error },
      'Error starting worker command JetStream ingress'
    );
    throw error;
  }

  return ingress;
}
