import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerService } from '@core/services/worker.service';
import {
  WorkerExternalConnectionTokenPayload,
  WorkerExternalConnectionTokenService,
} from '@core/services/workerExternalConnectionToken.service';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { WorkerConnectionQrCodeRequesterUseCase } from '@core/useCases/worker/WorkerConnectionQrCodeRequester.useCase';
import type { ViewWorkerResponse } from '@core/schema/worker/viewWorker/response.schema';

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
    const worker = await this.workerService.viewWorker(
      payload.account_id,
      payload.worker_id
    );

    if (!worker) {
      throw new Error(t('worker_not_found'));
    }

    this.validateWorkerSnapshot(t, payload, worker);

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

  private validateWorkerSnapshot(
    t: TFunction<'translation', undefined>,
    payload: WorkerExternalConnectionTokenPayload,
    worker: ViewWorkerResponse
  ): void {
    try {
      this.workerExternalConnectionTokenService.validateWorkerSnapshot(
        payload,
        {
          server_id: worker.server?.id,
          worker_type_id: worker.type?.id,
          worker_updated_at: worker.updated_at,
          external_connection_revision: worker.external_connection_revision,
        }
      );
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(t(error.message));
      }

      throw error;
    }
  }
}
