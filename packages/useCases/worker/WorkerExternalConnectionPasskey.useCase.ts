import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import {
  WorkerExternalConnectionTokenPayload,
  WorkerExternalConnectionTokenService,
} from '@core/services/workerExternalConnectionToken.service';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import {
  WorkerConnectionPasskeyConfirmationInput,
  WorkerConnectionPasskeyResponseInput,
  WorkerConnectionPasskeyUseCase,
} from '@core/useCases/worker/WorkerConnectionPasskey.useCase';
import { WorkerService } from '@core/services/worker.service';

@injectable()
export class WorkerExternalConnectionPasskeyUseCase {
  constructor(
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(WorkerExternalConnectionTokenService)
    private readonly workerExternalConnectionTokenService: WorkerExternalConnectionTokenService,
    @inject(WorkerConnectionPasskeyUseCase)
    private readonly workerConnectionPasskeyUseCase: WorkerConnectionPasskeyUseCase
  ) {}

  async sendResponse(
    t: TFunction<'translation', undefined>,
    token: string,
    input: WorkerConnectionPasskeyResponseInput
  ): Promise<IBaileysConnectionState> {
    const payload = await this.validateToken(t, token);

    return this.workerConnectionPasskeyUseCase.sendResponse(
      t,
      payload.account_id,
      payload.worker_id,
      input
    );
  }

  async confirm(
    t: TFunction<'translation', undefined>,
    token: string,
    input: WorkerConnectionPasskeyConfirmationInput
  ): Promise<IBaileysConnectionState> {
    const payload = await this.validateToken(t, token);

    return this.workerConnectionPasskeyUseCase.confirm(
      t,
      payload.account_id,
      payload.worker_id,
      input
    );
  }

  private async validateToken(
    t: TFunction<'translation', undefined>,
    token: string
  ): Promise<WorkerExternalConnectionTokenPayload> {
    try {
      const payload = this.workerExternalConnectionTokenService.validate(token);
      const worker = await this.workerService.viewWorker(
        payload.account_id,
        payload.worker_id
      );

      if (!worker) {
        throw new Error('worker_not_found');
      }

      this.workerExternalConnectionTokenService.validateWorkerSnapshot(
        payload,
        {
          server_id: worker.server?.id,
          worker_type_id: worker.type?.id,
          worker_updated_at: worker.updated_at,
          external_connection_revision: worker.external_connection_revision,
        }
      );

      return payload;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(t(error.message));
      }

      throw error;
    }
  }
}
