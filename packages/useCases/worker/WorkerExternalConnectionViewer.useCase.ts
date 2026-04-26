import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import jwt from 'jsonwebtoken';
import { centrifugoEnvironment } from '@core/config/environments';
import { workerCentrifugoQueue } from '@core/common/functions/centrifugoQueue';
import { WorkerService } from '@core/services/worker.service';
import {
  WorkerExternalConnectionTokenPayload,
  WorkerExternalConnectionTokenService,
} from '@core/services/workerExternalConnectionToken.service';
import { WorkerExternalConnectionViewResponse } from '@core/schema/worker/externalConnection/response.schema';

@injectable()
export class WorkerExternalConnectionViewerUseCase {
  constructor(
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(WorkerExternalConnectionTokenService)
    private readonly workerExternalConnectionTokenService: WorkerExternalConnectionTokenService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    token: string
  ): Promise<WorkerExternalConnectionViewResponse> {
    const payload = this.validateToken(t, token);
    const worker = await this.workerService.viewWorker(
      payload.account_id,
      payload.worker_id
    );

    if (!worker) {
      throw new Error(t('worker_not_found'));
    }

    const subject = `external:${payload.worker_id}`;
    const channel = workerCentrifugoQueue(payload.account_id);

    return {
      worker_id: worker.id,
      account_id: payload.account_id,
      name: worker.name,
      number: worker.number,
      status: worker.status,
      type: worker.type,
      expires_at: new Date(payload.exp).toISOString(),
      centrifugo_url: centrifugoEnvironment.centrifugoWsUrl,
      centrifugo_connection_token: this.generateConnectionToken(
        subject,
        payload
      ),
      centrifugo_subscription_token: this.generateSubscriptionToken(
        subject,
        channel,
        payload
      ),
      centrifugo_channel: channel,
    };
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

  private generateConnectionToken(
    subject: string,
    payload: WorkerExternalConnectionTokenPayload
  ): string {
    return jwt.sign(
      {
        sub: subject,
        exp: Math.floor(payload.exp / 1000),
        params: {
          workerID: payload.worker_id,
        },
      },
      centrifugoEnvironment.centrifugoHmacSecretKey,
      { algorithm: 'HS256' }
    );
  }

  private generateSubscriptionToken(
    subject: string,
    channel: string,
    payload: WorkerExternalConnectionTokenPayload
  ): string {
    return jwt.sign(
      {
        sub: subject,
        channel,
        exp: Math.floor(payload.exp / 1000),
      },
      centrifugoEnvironment.centrifugoHmacSecretKey,
      { algorithm: 'HS256' }
    );
  }
}
