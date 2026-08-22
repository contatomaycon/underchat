import 'reflect-metadata';

import fs from 'node:fs';
import path from 'node:path';
import { container } from 'tsyringe';

jest.mock('@core/common/functions/kafkaConsumerRunner', () => ({
  KafkaConsumerRunner: class KafkaConsumerRunner {},
}));
jest.mock('@whiskeysockets/baileys', () => ({
  jidNormalizedUser: jest.fn((jid: string) => jid),
}));
jest.mock('@core/services/baileys', () => ({
  BaileysService: class BaileysService {},
}));
jest.mock('@core/services/wwebjs', () => ({
  WwebjsService: class WwebjsService {},
}));
jest.mock('@core/services/baileys/methods/incoming.service', () => ({
  BaileysIncomingMessageService: class BaileysIncomingMessageService {},
}));
jest.mock('@core/services/wwebjs/methods/incoming.service', () => ({
  WwebjsIncomingMessageService: class WwebjsIncomingMessageService {},
}));

import { WebhookIntegrationConsume } from '@core/consumer/webhook/WebhookIntegration.consume';
import { WebhookIntegrationWwebjsConsume } from '@core/consumer/webhook/WebhookIntegrationWwebjs.consume';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { BaileysService } from '@core/services/baileys';
import { WwebjsService } from '@core/services/wwebjs';
import { WorkerIntegrationEntitlementService } from '@core/services/workerIntegrationEntitlement.service';
import { MessageStatusService } from '@core/services/messageStatus.service';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { MessageStatusPendingService } from '@core/services/messageStatusPending.service';
import { BaileysIncomingMessageService } from '@core/services/baileys/methods/incoming.service';
import { WwebjsIncomingMessageService } from '@core/services/wwebjs/methods/incoming.service';

const workerIndexes = [
  'apps/worker_baileys/src/index.ts',
  'apps/worker_wwebjs/src/index.ts',
];

describe('worker integration entitlement bootstrap', () => {
  it.each(workerIndexes)(
    'does not register PostgreSQL in %s',
    (relativePath) => {
      const source = fs.readFileSync(
        path.resolve(process.cwd(), relativePath),
        'utf8'
      );

      expect(source).not.toContain(
        "import dbConnector from '@core/config/database'"
      );
      expect(source).not.toContain(
        "server.register(safePlugin(dbConnector, 'database'));"
      );
    }
  );

  it('resolves both webhook consumers with Redis and no PostgreSQL registration', () => {
    const child = container.createChildContainer();

    child.register('Redis', { useValue: {} as never });
    child.register(KafkaServiceQueueService, { useValue: {} as never });
    child.register(StreamProducerService, { useValue: {} as never });
    child.register(BaileysService, { useValue: {} as never });
    child.register(WwebjsService, { useValue: {} as never });
    child.register(BaileysIncomingMessageService, {
      useValue: {} as never,
    });
    child.register(WwebjsIncomingMessageService, {
      useValue: {} as never,
    });
    child.register(WorkerIntegrationEntitlementService, {
      useClass: WorkerIntegrationEntitlementService,
    });
    child.register(WebhookIntegrationConsume, {
      useClass: WebhookIntegrationConsume,
    });
    child.register(WebhookIntegrationWwebjsConsume, {
      useClass: WebhookIntegrationWwebjsConsume,
    });

    const baileysConsumer = child.resolve(WebhookIntegrationConsume);
    const wwebjsConsumer = child.resolve(WebhookIntegrationWwebjsConsume);

    expect(baileysConsumer).toBeInstanceOf(WebhookIntegrationConsume);
    expect(wwebjsConsumer).toBeInstanceOf(WebhookIntegrationWwebjsConsume);
    expect(
      (
        baileysConsumer as unknown as {
          workerIntegrationEntitlementService: unknown;
        }
      ).workerIntegrationEntitlementService
    ).toBeInstanceOf(WorkerIntegrationEntitlementService);
    expect(
      (
        wwebjsConsumer as unknown as {
          workerIntegrationEntitlementService: unknown;
        }
      ).workerIntegrationEntitlementService
    ).toBeInstanceOf(WorkerIntegrationEntitlementService);
  });

  it('resolves message status without a persistent webhook service', () => {
    const child = container.createChildContainer();

    child.register('Redis', { useValue: {} as never });
    child.register(ElasticDatabaseService, { useValue: {} as never });
    child.register(CentrifugoService, { useValue: {} as never });
    child.register(MessageStatusPendingService, { useValue: {} as never });
    child.register(MessageStatusService, { useClass: MessageStatusService });

    expect(child.resolve(MessageStatusService)).toBeInstanceOf(
      MessageStatusService
    );
  });
});
