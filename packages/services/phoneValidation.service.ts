import { injectable, inject } from 'tsyringe';
import { WorkerActiveByAccountViewerRepository } from '@core/repositories/worker/WorkerActiveByAccountViewer.repository';
import { IWorkerActiveByAccount } from '@core/common/interfaces/IWorkerActiveByAccount';
import { KafkaBaileysQueueService } from '@core/services/kafkaBaileysQueue.service';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { IPhoneValidationRequest } from '@core/common/interfaces/IPhoneValidationRequest';
import { IPhoneValidationResponse } from '@core/common/interfaces/IPhoneValidationResponse';
import Redis from 'ioredis';
import { v7 as uuidv7 } from 'uuid';
import { onlyDigits } from '@core/common/functions/onlyDigits';

@injectable()
export class PhoneValidationService {
  private readonly defaultTimeout = 5000;
  private readonly cacheTTL = 30; // 30 segundos

  constructor(
    @inject(WorkerActiveByAccountViewerRepository)
    private readonly workerActiveByAccountViewerRepository: WorkerActiveByAccountViewerRepository,
    private readonly kafkaBaileysQueueService: KafkaBaileysQueueService,
    private readonly streamProducerService: StreamProducerService,
    @inject('Redis') private readonly redis: Redis
  ) {}

  private async waitForResponse(
    requestId: string,
    timeout: number = this.defaultTimeout
  ): Promise<IPhoneValidationResponse> {
    const cacheKey = `phone_validation:${requestId}`;
    const startTime = Date.now();
    const pollInterval = 100;

    while (Date.now() - startTime < timeout) {
      const response = await this.redis.get(cacheKey);
      if (response) {
        const parsedResponse = JSON.parse(response) as IPhoneValidationResponse;

        await this.redis.del(cacheKey);
        return parsedResponse;
      }
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    await this.redis.del(cacheKey);
    throw new Error('Phone validation timeout');
  }

  private async validateWithWorker(
    worker: IWorkerActiveByAccount,
    accountId: string,
    phone: string,
    phoneDdi?: string | null,
    timeout: number = this.defaultTimeout
  ): Promise<IPhoneValidationResponse> {
    const requestId = uuidv7();

    const request: IPhoneValidationRequest = {
      request_id: requestId,
      account_id: accountId,
      worker_id: worker.worker_id,
      phone,
      phone_ddi: phoneDdi,
    };

    const topic = this.kafkaBaileysQueueService.workerValidatePhone(
      worker.worker_id
    );
    await this.streamProducerService.send(topic, request);

    return this.waitForResponse(requestId, timeout);
  }

  private getCacheKey(
    accountId: string,
    phone: string,
    phoneDdi?: string | null
  ): string {
    const normalizedPhone = onlyDigits(phone);
    const normalizedDdi = phoneDdi ? onlyDigits(phoneDdi) : '';
    const phoneKey = normalizedDdi
      ? `${normalizedDdi}${normalizedPhone}`
      : normalizedPhone;
    return `phone_validation_result:${accountId}:${phoneKey}`;
  }

  private async getCachedResult(
    accountId: string,
    phone: string,
    phoneDdi?: string | null
  ): Promise<IPhoneValidationResponse | null> {
    const cacheKey = this.getCacheKey(accountId, phone, phoneDdi);
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as IPhoneValidationResponse;
    }
    return null;
  }

  private async setCachedResult(
    accountId: string,
    phone: string,
    phoneDdi: string | null | undefined,
    result: IPhoneValidationResponse
  ): Promise<void> {
    const cacheKey = this.getCacheKey(accountId, phone, phoneDdi);
    await this.redis.set(cacheKey, JSON.stringify(result), 'EX', this.cacheTTL);
  }

  private async removeCachedResult(
    accountId: string,
    phone: string,
    phoneDdi?: string | null
  ): Promise<void> {
    const cacheKey = this.getCacheKey(accountId, phone, phoneDdi);
    await this.redis.del(cacheKey);
  }

  private isValidationError(error: Error): boolean {
    const validationMessages = [
      'phone_number_not_valid_on_whatsapp',
      'Phone number is not valid on WhatsApp',
      'Phone number is valid on WhatsApp',
    ];

    return validationMessages.some((msg) =>
      error.message.toLowerCase().includes(msg.toLowerCase())
    );
  }

  validatePhone = async (
    accountId: string,
    phone: string,
    phoneDdi?: string | null,
    timeout: number = this.defaultTimeout
  ): Promise<IPhoneValidationResponse> => {
    const cachedResult = await this.getCachedResult(accountId, phone, phoneDdi);
    if (cachedResult) {
      return cachedResult;
    }

    const workers =
      await this.workerActiveByAccountViewerRepository.viewWorkerActiveByAccount(
        accountId
      );

    if (!workers || workers.length === 0) {
      throw new Error('No active worker found for this account');
    }

    const workersToTry = workers.slice(0, 3);
    let lastError: Error | null = null;

    for (const worker of workersToTry) {
      try {
        const response = await this.validateWithWorker(
          worker,
          accountId,
          phone,
          phoneDdi,
          timeout
        );

        if (response.valid !== undefined) {
          await this.setCachedResult(accountId, phone, phoneDdi, response);

          return response;
        }

        if (response.error) {
          const error = new Error(response.error);
          if (this.isValidationError(error)) {
            await this.setCachedResult(accountId, phone, phoneDdi, response);
            return response;
          }

          await this.removeCachedResult(accountId, phone, phoneDdi);
          lastError = error;
          continue;
        }

        await this.setCachedResult(accountId, phone, phoneDdi, response);
        return response;
      } catch (error) {
        if (error instanceof Error) {
          if (
            error.message.includes('timeout') ||
            error.message.includes('No active worker') ||
            error.message.includes('disconnected') ||
            error.message.includes('connection')
          ) {
            await this.removeCachedResult(accountId, phone, phoneDdi);

            lastError = error;
            continue;
          }

          if (this.isValidationError(error)) {
            await this.removeCachedResult(accountId, phone, phoneDdi);

            throw error;
          }

          await this.removeCachedResult(accountId, phone, phoneDdi);
          lastError = error;
          continue;
        }

        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }

    await this.removeCachedResult(accountId, phone, phoneDdi);

    if (lastError) throw lastError;

    throw new Error('Failed to validate phone with all available workers');
  };
}
