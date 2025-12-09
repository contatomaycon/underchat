import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { ContactExporterRepository } from '@core/repositories/contact/ContactExporter.repository';
import { ExportContactResponse } from '@core/schema/contact/exportContact/response.schema';

@injectable()
export class ContactExporterUseCase {
  constructor(
    private readonly contactExporterRepository: ContactExporterRepository
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string
  ): Promise<ExportContactResponse[]> {
    return this.contactExporterRepository.exportContacts(accountId);
  }
}
