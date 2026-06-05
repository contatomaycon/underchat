import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerService } from '@core/services/worker.service';
import {
  WorkerExternalConnectionTokenPayload,
  WorkerExternalConnectionTokenService,
} from '@core/services/workerExternalConnectionToken.service';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { WorkerConnectionQrCodeRequesterUseCase } from '@core/useCases/worker/WorkerConnectionQrCodeRequester.useCase';

@injectable()
export class WorkerExternalConnectionQrCodeRequesterUseCase {
  constructor(
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(WorkerExternalConnectionTokenService)
    private readonly workerExternalConnectionTokenService: WorkerExternalConnectionTokenService,
    @inject(WorkerConnectionQrCodeRequesterUseCase)
    private readonly workerConnectionQrCodeRequesterUseCase: WorkerConnectionQrCodeRequesterUseCase
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    token: string
  ): Promise<IBaileysConnectionState> {
    const payload = this.validateToken(t, token);
    const existsWorker = await this.workerService.existsWorkerById(
      payload.account_id,
      payload.worker_id
    );

    if (!existsWorker) {
      throw new Error(t('worker_not_found'));
    }

    return this.workerConnectionQrCodeRequesterUseCase.execute(
      t,
      payload.account_id,
      payload.worker_id,
      'external'
    );
  }

  private validateToken(
    t: TFunction<'translation', undefined>,
    token: string
  ): WorkerExternalConnectionTokenPayload {
    try {
      return this.workerExternalConnectionTokenService.validate(token);
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(t(error.message));
      }

      throw error;
    }
  }
}
