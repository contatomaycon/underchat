import { injectable, inject } from 'tsyringe';
import { WorkerActiveByAccountViewerRepository } from '@core/repositories/worker/WorkerActiveByAccountViewer.repository';
import { IWorkerActiveByAccount } from '@core/common/interfaces/IWorkerActiveByAccount';
import { IPhoneValidationRequest } from '@core/common/interfaces/IPhoneValidationRequest';
import { IPhoneValidationResponse } from '@core/common/interfaces/IPhoneValidationResponse';
import Redis from 'ioredis';
import { v7 as uuidv7 } from 'uuid';
import { onlyDigits } from '@core/common/functions/onlyDigits';
import { WorkerGrpcClientService } from '@core/services/workerGrpcClient.service';

@injectable()
export class PhoneValidationService {
  private readonly defaultTimeout = 5000;
  private readonly cacheTTL = 30; // 30 segundos

  constructor(
    @inject(WorkerActiveByAccountViewerRepository)
    private readonly workerActiveByAccountViewerRepository: WorkerActiveByAccountViewerRepository,
    @inject(WorkerGrpcClientService)
    private readonly workerGrpcClientService: WorkerGrpcClientService,
    @inject('Redis') private readonly redis: Redis
  ) {}

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

    return this.workerGrpcClientService.validatePhone(
      worker.server_id,
      request,
      timeout
    );
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

  private async processValidationResponse(
    response: IPhoneValidationResponse,
    accountId: string,
    phone: string,
    phoneDdi?: string | null
  ): Promise<IPhoneValidationResponse | null> {
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
      return null;
    }

    await this.setCachedResult(accountId, phone, phoneDdi, response);
    return response;
  }

  private isRetryableError(error: Error): boolean {
    const retryableMessages = [
      'timeout',
      'deadline exceeded',
      'No active worker',
      'disconnected',
      'connection',
      'unavailable',
    ];

    return retryableMessages.some((msg) =>
      error.message.toLowerCase().includes(msg.toLowerCase())
    );
  }

  private async handleValidationError(
    error: unknown,
    accountId: string,
    phone: string,
    phoneDdi?: string | null
  ): Promise<{ shouldRetry: boolean; error: Error }> {
    if (!(error instanceof Error)) {
      return {
        shouldRetry: false,
        error: new Error(String(error)),
      };
    }

    await this.removeCachedResult(accountId, phone, phoneDdi);

    if (this.isRetryableError(error)) {
      return { shouldRetry: true, error };
    }

    if (this.isValidationError(error)) {
      throw error;
    }

    return { shouldRetry: true, error };
  }

  private async tryValidateWithWorkers(
    workers: IWorkerActiveByAccount[],
    accountId: string,
    phone: string,
    phoneDdi: string | null | undefined,
    timeout: number
  ): Promise<IPhoneValidationResponse> {
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

        const processedResponse = await this.processValidationResponse(
          response,
          accountId,
          phone,
          phoneDdi
        );

        if (processedResponse) {
          return processedResponse;
        }

        lastError = new Error(response.error || 'Unknown validation error');
      } catch (error) {
        const { shouldRetry, error: handledError } =
          await this.handleValidationError(error, accountId, phone, phoneDdi);

        if (!shouldRetry) {
          throw handledError;
        }

        lastError = handledError;
      }
    }

    await this.removeCachedResult(accountId, phone, phoneDdi);

    if (lastError) {
      throw lastError;
    }

    throw new Error('Failed to validate phone with all available workers');
  }

  private prioritizeWorkersForValidation(
    workers: IWorkerActiveByAccount[],
    preferredWorkerId?: string
  ): IWorkerActiveByAccount[] {
    if (!preferredWorkerId) {
      return workers;
    }

    const preferredWorker = workers.find(
      (worker) => worker.worker_id === preferredWorkerId
    );
    if (!preferredWorker) {
      return workers;
    }

    return [
      preferredWorker,
      ...workers.filter((worker) => worker.worker_id !== preferredWorkerId),
    ];
  }

  validatePhone = async (
    accountId: string,
    phone: string,
    phoneDdi?: string | null,
    timeout: number = this.defaultTimeout,
    options?: { bypassCache?: boolean; preferredWorkerId?: string }
  ): Promise<IPhoneValidationResponse> => {
    if (!options?.bypassCache) {
      const cachedResult = await this.getCachedResult(
        accountId,
        phone,
        phoneDdi
      );
      if (cachedResult) {
        return cachedResult;
      }
    }

    const workers =
      await this.workerActiveByAccountViewerRepository.viewWorkerActiveByAccount(
        accountId
      );

    if (!workers || workers.length === 0) {
      throw new Error('No active worker found for this account');
    }

    const workersToValidate = this.prioritizeWorkersForValidation(
      workers,
      options?.preferredWorkerId
    );

    return this.tryValidateWithWorkers(
      workersToValidate,
      accountId,
      phone,
      phoneDdi,
      timeout
    );
  };
}
