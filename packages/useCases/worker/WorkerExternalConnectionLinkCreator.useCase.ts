import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { generalEnvironment } from '@core/config/environments';
import { EAppEnvironment } from '@core/common/enums/EAppEnvironment';
import { WorkerService } from '@core/services/worker.service';
import { WorkerExternalConnectionTokenService } from '@core/services/workerExternalConnectionToken.service';
import { WorkerExternalConnectionLinkResponse } from '@core/schema/worker/externalConnectionLink/response.schema';

@injectable()
export class WorkerExternalConnectionLinkCreatorUseCase {
  constructor(
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(WorkerExternalConnectionTokenService)
    private readonly workerExternalConnectionTokenService: WorkerExternalConnectionTokenService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string,
    requestOrigin?: string
  ): Promise<WorkerExternalConnectionLinkResponse> {
    const existsWorker = await this.workerService.existsWorkerById(
      accountId,
      workerId
    );

    if (!existsWorker) {
      throw new Error(t('worker_not_found'));
    }

    const { token, expiresAt } =
      this.workerExternalConnectionTokenService.create(accountId, workerId);

    return {
      token,
      url: `${this.resolveBaseUrl(requestOrigin)}/connection/external/${encodeURIComponent(token)}`,
      expires_at: expiresAt.toISOString(),
    };
  }

  private resolveBaseUrl(requestOrigin?: string): string {
    const rawBaseUrl = (
      requestOrigin || generalEnvironment.appUrlPublic
    ).trim();
    const withoutTrailingSlash = rawBaseUrl.replace(/\/+$/, '');

    if (/^https?:\/\//i.test(withoutTrailingSlash)) {
      return withoutTrailingSlash;
    }

    const protocol =
      generalEnvironment.appEnvironment === EAppEnvironment.local
        ? 'http'
        : 'https';

    return `${protocol}://${withoutTrailingSlash}`;
  }
}
