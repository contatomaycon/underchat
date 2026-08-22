import { singleton, inject } from 'tsyringe';
import { wwebjsEnvironment } from '@core/config/environments';
import { IPhoneValidationRequest } from '@core/common/interfaces/IPhoneValidationRequest';
import { IPhoneValidationResponse } from '@core/common/interfaces/IPhoneValidationResponse';
import { WwebjsService } from '@core/services/wwebjs';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { WwebjsIncomingMessageService } from '@core/services/wwebjs/methods/incoming.service';
import type { IWhatsappRuntimeFence } from '@core/services/whatsappRuntimeFence.service';

class PhoneValidationRuntimeStaleError extends Error {
  constructor() {
    super('Phone validation runtime is stale');
    this.name = 'PhoneValidationRuntimeStaleError';
  }
}

@singleton()
export class PhoneValidationWwebjsConsume {
  constructor(
    @inject(WwebjsService)
    private readonly wwebjsService: WwebjsService,
    @inject(WwebjsIncomingMessageService)
    private readonly wwebjsIncomingMessageService: WwebjsIncomingMessageService,
    @inject(StreamProducerService)
    private readonly streamProducerService: StreamProducerService,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService
  ) {}

  private async processValidation(
    data: IPhoneValidationRequest,
    assertActive: () => void = () => undefined
  ): Promise<void> {
    const responseTopic =
      this.kafkaServiceQueueService.phoneValidationResponse();
    const connectionScope =
      await this.captureActiveConnectionScope(assertActive);

    if (!data.phone_ddi) {
      const invalidResponse: IPhoneValidationResponse = {
        request_id: data.request_id,
        account_id: data.account_id,
        worker_id: data.worker_id,
        valid: false,
        error: 'DDI is required for phone validation',
        source_provider: connectionScope.source_provider,
        runtime_generation: connectionScope.runtime_generation,
        connection_epoch: connectionScope.connection_epoch,
      };

      await this.assertConnectionScopeActive(connectionScope, assertActive);
      await this.streamProducerService.send(
        responseTopic,
        invalidResponse,
        data.request_id,
        undefined,
        () => this.assertConnectionScopeActive(connectionScope, assertActive)
      );
      await this.assertConnectionScopeActive(connectionScope, assertActive);
      return;
    }

    const result = await this.wwebjsService.validatePhone(
      data.phone_ddi,
      data.phone
    );
    await this.assertConnectionScopeActive(connectionScope, assertActive);

    const response: IPhoneValidationResponse = {
      request_id: data.request_id,
      account_id: data.account_id,
      worker_id: data.worker_id,
      valid: result.valid,
      jid: result.jid ?? null,
      phone: result.phone ?? null,
      source_provider: connectionScope.source_provider,
      runtime_generation: connectionScope.runtime_generation,
      connection_epoch: connectionScope.connection_epoch,
    };

    await this.streamProducerService.send(
      responseTopic,
      response,
      data.request_id,
      undefined,
      () => this.assertConnectionScopeActive(connectionScope, assertActive)
    );
    await this.assertConnectionScopeActive(connectionScope, assertActive);
  }

  private async captureActiveConnectionScope(
    assertActive: () => void
  ): Promise<IWhatsappRuntimeFence> {
    assertActive();
    const scope =
      await this.wwebjsIncomingMessageService.captureActiveConnectionScope();
    assertActive();
    if (
      !scope ||
      scope.worker_id !== wwebjsEnvironment.wwebjsWorkerId ||
      scope.source_provider !== 'wwebjs'
    ) {
      throw new PhoneValidationRuntimeStaleError();
    }
    return scope;
  }

  private async assertConnectionScopeActive(
    expected: IWhatsappRuntimeFence,
    assertActive: () => void
  ): Promise<void> {
    assertActive();
    const current =
      await this.wwebjsIncomingMessageService.captureActiveConnectionScope();
    assertActive();
    if (
      !current ||
      current.worker_id !== expected.worker_id ||
      current.source_provider !== expected.source_provider ||
      current.runtime_generation !== expected.runtime_generation ||
      current.connection_epoch !== expected.connection_epoch
    ) {
      throw new PhoneValidationRuntimeStaleError();
    }
  }
}
