import type { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { MessageSendWwebjsConsume } from '@core/consumer/message/MessageSendWwebjs.consume';
import { NotificationMessageSendWwebjsConsume } from '@core/consumer/notification/NotificationMessageSendWwebjs.consume';
import { ScheduleMessageWwebjsConsume } from '@core/consumer/schedule/ScheduleMessageWwebjs.consume';
import { WebhookIntegrationWwebjsConsume } from '@core/consumer/webhook/WebhookIntegrationWwebjs.consume';
import { MessageMarkReadWwebjsConsume } from '@core/consumer/worker/MessageMarkReadWwebjs.consume';
import { WorkerConfigUpdateWwebjsConsume } from '@core/consumer/worker/WorkerConfigUpdateWwebjs.consume';
import { wwebjsEnvironment } from '@core/config/environments';
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
  const runtimeGeneration = Number(wwebjsEnvironment.runtimeGeneration);
  if (!Number.isSafeInteger(runtimeGeneration) || runtimeGeneration <= 0) {
    throw new Error('worker_command_runtime_generation_required');
  }
  return runtimeGeneration;
}

export async function startWorkerCommandIngressWwebjsConsume(
  server: FastifyInstance,
  onCreated?: (consumer: WorkerCommandJetStreamIngressService) => void
): Promise<WorkerCommandJetStreamIngressService> {
  const messageSend = container.resolve(MessageSendWwebjsConsume);
  const markRead = container.resolve(MessageMarkReadWwebjsConsume);
  const notificationSend = container.resolve(
    NotificationMessageSendWwebjsConsume
  );
  const scheduleSend = container.resolve(ScheduleMessageWwebjsConsume);
  const workerConfig = container.resolve(WorkerConfigUpdateWwebjsConsume);
  const webhookIntegration = container.resolve(WebhookIntegrationWwebjsConsume);

  const handleProviderCommand = (input: WorkerCommandIngressHandlerInput) =>
    messageSend.handleJetStreamCommand(input);
  const ingress = new WorkerCommandJetStreamIngressService(
    {
      accountId: wwebjsEnvironment.wwebjsAccountId,
      workerId: wwebjsEnvironment.wwebjsWorkerId,
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
