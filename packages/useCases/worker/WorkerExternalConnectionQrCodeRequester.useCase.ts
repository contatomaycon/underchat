import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { EBaileysConnectionType } from '@core/common/enums/EBaileysConnectionType';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { WorkerService } from '@core/services/worker.service';
import {
  WorkerExternalConnectionTokenPayload,
  WorkerExternalConnectionTokenService,
} from '@core/services/workerExternalConnectionToken.service';
import { WorkerChangeStatusConnectionUseCase } from '@core/useCases/worker/WorkerChangeStatusConnection.useCase';

@injectable()
export class WorkerExternalConnectionQrCodeRequesterUseCase {
  constructor(
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(WorkerExternalConnectionTokenService)
    private readonly workerExternalConnectionTokenService: WorkerExternalConnectionTokenService,
    @inject(WorkerChangeStatusConnectionUseCase)
    private readonly workerChangeStatusConnectionUseCase: WorkerChangeStatusConnectionUseCase
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    token: string
  ): Promise<void> {
    const payload = this.validateToken(t, token);
    const existsWorker = await this.workerService.existsWorkerById(
      payload.account_id,
      payload.worker_id
    );

    if (!existsWorker) {
      throw new Error(t('worker_not_found'));
    }

    await this.workerChangeStatusConnectionUseCase.execute(
      t,
      payload.account_id,
      {
        worker_id: payload.worker_id,
        status: EWorkerStatus.online,
        type: EBaileysConnectionType.qrcode,
      }
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
