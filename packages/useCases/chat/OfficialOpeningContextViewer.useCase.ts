import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { ContactService } from '@core/services/contact.service';
import { WorkerService } from '@core/services/worker.service';
import { PasswordEncryptorService } from '@core/services/passwordEncryptor.service';
import { MetaWhatsappEmbeddedService } from '@core/services/metaWhatsappEmbedded.service';
import { OfficialWhatsappTemplateService } from '@core/services/officialWhatsappTemplate.service';
import { WorkerWhatsappOfficialConnectionRepository } from '@core/repositories/whatsapp/WorkerWhatsappOfficialConnection.repository';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { OfficialOpeningContextResponse } from '@core/schema/chat/officialOpeningContext/response.schema';
import { OfficialOpeningContextRequest } from '@core/schema/chat/officialOpeningContext/request.schema';

@injectable()
export class OfficialOpeningContextViewerUseCase {
  constructor(
    @inject(ContactService)
    private readonly contactService: ContactService,
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(PasswordEncryptorService)
    private readonly passwordEncryptorService: PasswordEncryptorService,
    @inject(MetaWhatsappEmbeddedService)
    private readonly metaWhatsappEmbeddedService: MetaWhatsappEmbeddedService,
    @inject(OfficialWhatsappTemplateService)
    private readonly officialWhatsappTemplateService: OfficialWhatsappTemplateService,
    @inject(WorkerWhatsappOfficialConnectionRepository)
    private readonly workerWhatsappOfficialConnectionRepository: WorkerWhatsappOfficialConnectionRepository
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    input: OfficialOpeningContextRequest,
    userChannels: { id: string; name: string }[] = []
  ): Promise<OfficialOpeningContextResponse> {
    if (userChannels.length > 0) {
      const channelIds = userChannels.map((channel) => channel.id);
      if (!channelIds.includes(input.worker_id)) {
        throw new Error(t('chat_access_denied'));
      }
    }

    const [workerType, contact] = await Promise.all([
      this.workerService.viewWorkerType(accountId, input.worker_id),
      this.contactService.viewContactById(input.contact_id, accountId),
    ]);

    if (!workerType || !contact) {
      throw new Error(t('chat_create_not_found'));
    }

    if (workerType.worker_type_id !== EWorkerType.whatsapp) {
      throw new Error(t('official_opening_only_official_channel'));
    }

    const connection =
      await this.workerWhatsappOfficialConnectionRepository.findActiveByWorkerId(
        input.worker_id
      );

    if (!connection) {
      throw new Error(t('official_opening_connection_not_found'));
    }

    const accessToken = this.passwordEncryptorService.decrypt(
      connection.access_token_encrypted
    );
    const approvedTemplates =
      await this.metaWhatsappEmbeddedService.listApprovedMessageTemplates({
        apiVersion: connection.api_version,
        accessToken,
        wabaId: connection.waba_id,
      });

    return {
      worker_id: input.worker_id,
      is_official: true,
      requires_template: true,
      templates:
        this.officialWhatsappTemplateService.normalizeTemplates(
          approvedTemplates
        ),
    };
  }
}
