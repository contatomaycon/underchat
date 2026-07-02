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

@injectable()
export class WorkerExternalConnectionPasskeyUseCase {
  constructor(
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
    const payload = this.validateToken(t, token);

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
    const payload = this.validateToken(t, token);

    return this.workerConnectionPasskeyUseCase.confirm(
      t,
      payload.account_id,
      payload.worker_id,
      input
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
