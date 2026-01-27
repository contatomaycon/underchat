import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { IntegrationService } from '@core/services/integration.service';
import { WebhookMappingValidationError } from '@core/common/exceptions/WebhookMappingValidationError';

@injectable()
export class WebhookMappingSaverUseCase {
  constructor(private readonly integrationService: IntegrationService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    apiKeyId: string,
    mapping: Record<string, string | string[]>
  ): Promise<boolean> {
    this.validateTransferMapping(mapping, t);

    const success = await this.integrationService.saveWebhookMapping(
      accountId,
      apiKeyId,
      mapping
    );

    if (!success) {
      throw new Error(t('webhook_mapping_save_error'));
    }

    return success;
  }

  private validateTransferMapping(
    mapping: Record<string, string | string[]>,
    t: TFunction<'translation', undefined>
  ): void {
    const messageType = mapping.message_type;
    if (typeof messageType !== 'string' || messageType !== 'message') {
      return;
    }

    const transferSectorId = mapping.transfer_sector_id;
    const transferSectorUserId = mapping.transfer_sector_user_id;
    const transferUserId = mapping.transfer_user_id;

    const hasTransferSector =
      typeof transferSectorId === 'string' && transferSectorId.length > 0;
    const hasTransferSectorUser =
      typeof transferSectorUserId === 'string' &&
      transferSectorUserId.length > 0;

    if (hasTransferSectorUser && !hasTransferSector) {
      throw new WebhookMappingValidationError(
        t('webhook_mapping_transfer_sector_required')
      );
    }

    if (
      typeof transferUserId === 'string' &&
      transferUserId.trim().length === 0
    ) {
      throw new WebhookMappingValidationError(
        t('webhook_mapping_transfer_user_required')
      );
    }
  }
}
