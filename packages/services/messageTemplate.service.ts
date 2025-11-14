import { injectable } from 'tsyringe';
import { MessageTemplateListerRepository } from '@core/repositories/messageTemplate/MessageTemplateLister.repository';
import { ListMessageTemplateRequest } from '@core/schema/messageTemplate/listMessageTemplate/request.schema';
import { ListMessageTemplateResponse } from '@core/schema/messageTemplate/listMessageTemplate/response.schema';
import { MessageTemplateCreatorRepository } from '@core/repositories/messageTemplate/MessageTemplateCreator.repository';
import { MessageStatusViewerExistsRepository } from '@core/repositories/messageTemplate/MessageStatusViewerExists.repository';
import { MessageTemplateViewerExistsRepository } from '@core/repositories/messageTemplate/MessageTemplateViewerExists.repository';
import { MessageTemplateViewerRepository } from '@core/repositories/messageTemplate/MessageTemplateViewer.repository';
import { ViewMessageTemplateResponse } from '@core/schema/messageTemplate/viewMessageTemplate/response.schema';
import { MessageTemplateDeleterRepository } from '@core/repositories/messageTemplate/MessageTemplateDeleter.repository';
import { MessageTemplateUpdaterRepository } from '@core/repositories/messageTemplate/MessageTemplateUpdater.repository';
import { ICreateMessageTemplate } from '@core/interfaces/repositories/messageTemplate/ICreateMessageTemplate';
import { IUpdateMessageTemplate } from '@core/interfaces/repositories/messageTemplate/IUpdateMessageTemplate';

@injectable()
export class MessageTemplateService {
  constructor(
    private readonly messageTemplateListerRepository: MessageTemplateListerRepository,
    private readonly messageTemplateCreatorRepository: MessageTemplateCreatorRepository,
    private readonly messageStatusViewerExistsRepository: MessageStatusViewerExistsRepository,
    private readonly messageTemplateViewerExistsRepository: MessageTemplateViewerExistsRepository,
    private readonly messageTemplateViewerRepository: MessageTemplateViewerRepository,
    private readonly messageTemplateDeleterRepository: MessageTemplateDeleterRepository,
    private readonly messageTemplateUpdaterRepository: MessageTemplateUpdaterRepository
  ) {}

  listMessageTemplates = async (
    perPage: number,
    currentPage: number,
    query: ListMessageTemplateRequest,
    isAdministrator: boolean,
    accountId: string
  ): Promise<[ListMessageTemplateResponse[], number]> => {
    const [result, total] = await Promise.all([
      this.messageTemplateListerRepository.listMessageTemplates(
        perPage,
        currentPage,
        query,
        isAdministrator,
        accountId
      ),
      this.messageTemplateListerRepository.listMessageTemplateTotal(
        query,
        isAdministrator,
        accountId
      ),
    ]);

    return [result, total];
  };

  createMessageTemplate = async (
    input: ICreateMessageTemplate
  ): Promise<string | null> => {
    return this.messageTemplateCreatorRepository.createMessageTemplate(input);
  };

  existsMessageStatusById = async (
    messageStatusId: string
  ): Promise<boolean> => {
    return this.messageStatusViewerExistsRepository.existsMessageStatusById(
      messageStatusId
    );
  };

  existsMessageTemplateById = async (
    messageTemplateId: string
  ): Promise<boolean> => {
    return this.messageTemplateViewerExistsRepository.existsMessageTemplateById(
      messageTemplateId
    );
  };

  viewMessageTemplateById = async (
    messageTemplateId: string
  ): Promise<ViewMessageTemplateResponse | null> => {
    return this.messageTemplateViewerRepository.viewMessageTemplateById(
      messageTemplateId
    );
  };

  deleteMessageTemplateById = async (
    messageTemplateId: string
  ): Promise<boolean> => {
    return this.messageTemplateDeleterRepository.deleteMessageTemplateById(
      messageTemplateId
    );
  };

  updateMessageTemplateById = async (
    input: IUpdateMessageTemplate
  ): Promise<boolean> => {
    return this.messageTemplateUpdaterRepository.updateMessageTemplateById(
      input
    );
  };
}
