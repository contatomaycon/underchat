import { inject, injectable } from 'tsyringe';
import { RandomMessageListerRepository } from '@core/repositories/randomMessage/RandomMessageLister.repository';
import { RandomMessageCreatorRepository } from '@core/repositories/randomMessage/RandomMessageCreator.repository';
import { RandomMessageViewerRepository } from '@core/repositories/randomMessage/RandomMessageViewer.repository';
import { RandomMessageUpdaterRepository } from '@core/repositories/randomMessage/RandomMessageUpdater.repository';
import { RandomMessageDeleterRepository } from '@core/repositories/randomMessage/RandomMessageDeleter.repository';
import { RandomMessageItemListerRepository } from '@core/repositories/randomMessage/RandomMessageItemLister.repository';
import { RandomMessageItemCreatorRepository } from '@core/repositories/randomMessage/RandomMessageItemCreator.repository';
import { RandomMessageItemViewerRepository } from '@core/repositories/randomMessage/RandomMessageItemViewer.repository';
import { RandomMessageItemUpdaterRepository } from '@core/repositories/randomMessage/RandomMessageItemUpdater.repository';
import { RandomMessageItemDeleterRepository } from '@core/repositories/randomMessage/RandomMessageItemDeleter.repository';
import { ListRandomMessageRequest } from '@core/schema/randomMessage/listRandomMessage/request.schema';
import { ListRandomMessageResponse } from '@core/schema/randomMessage/listRandomMessage/response.schema';
import { ViewRandomMessageResponse } from '@core/schema/randomMessage/viewRandomMessage/response.schema';
import { ListRandomMessageItemQueryRequest } from '@core/schema/randomMessage/listRandomMessageItem/request.schema';
import { ListRandomMessageItemResponse } from '@core/schema/randomMessage/listRandomMessageItem/response.schema';
import { ViewRandomMessageItemResponse } from '@core/schema/randomMessage/viewRandomMessageItem/response.schema';

@injectable()
export class RandomMessageService {
  constructor(
    @inject(RandomMessageListerRepository)
    private readonly randomMessageListerRepository: RandomMessageListerRepository,
    @inject(RandomMessageCreatorRepository)
    private readonly randomMessageCreatorRepository: RandomMessageCreatorRepository,
    @inject(RandomMessageViewerRepository)
    private readonly randomMessageViewerRepository: RandomMessageViewerRepository,
    @inject(RandomMessageUpdaterRepository)
    private readonly randomMessageUpdaterRepository: RandomMessageUpdaterRepository,
    @inject(RandomMessageDeleterRepository)
    private readonly randomMessageDeleterRepository: RandomMessageDeleterRepository,
    @inject(RandomMessageItemListerRepository)
    private readonly randomMessageItemListerRepository: RandomMessageItemListerRepository,
    @inject(RandomMessageItemCreatorRepository)
    private readonly randomMessageItemCreatorRepository: RandomMessageItemCreatorRepository,
    @inject(RandomMessageItemViewerRepository)
    private readonly randomMessageItemViewerRepository: RandomMessageItemViewerRepository,
    @inject(RandomMessageItemUpdaterRepository)
    private readonly randomMessageItemUpdaterRepository: RandomMessageItemUpdaterRepository,
    @inject(RandomMessageItemDeleterRepository)
    private readonly randomMessageItemDeleterRepository: RandomMessageItemDeleterRepository
  ) {}

  listRandomMessages = async (
    perPage: number,
    currentPage: number,
    query: ListRandomMessageRequest,
    accountId: string
  ): Promise<[ListRandomMessageResponse[], number]> => {
    const [result, total] = await Promise.all([
      this.randomMessageListerRepository.listRandomMessages(
        perPage,
        currentPage,
        query,
        accountId
      ),
      this.randomMessageListerRepository.listRandomMessageTotal(
        query,
        accountId
      ),
    ]);

    return [result, total];
  };

  createRandomMessage = async (input: {
    account_id: string;
    name: string;
    status: string;
  }): Promise<string | null> => {
    return this.randomMessageCreatorRepository.createRandomMessage(input);
  };

  viewRandomMessageById = async (
    randomMessageId: string,
    accountId: string
  ): Promise<ViewRandomMessageResponse | null> => {
    return this.randomMessageViewerRepository.viewRandomMessageById(
      randomMessageId,
      accountId
    );
  };

  updateRandomMessageById = async (input: {
    random_message_id: string;
    account_id: string;
    name?: string | null;
    status?: string | null;
  }): Promise<boolean> => {
    return this.randomMessageUpdaterRepository.updateRandomMessageById(input);
  };

  deleteRandomMessageById = async (
    randomMessageId: string,
    accountId: string
  ): Promise<boolean> => {
    return this.randomMessageDeleterRepository.deleteRandomMessageById(
      randomMessageId,
      accountId
    );
  };

  listRandomMessageItems = async (
    perPage: number,
    currentPage: number,
    query: ListRandomMessageItemQueryRequest,
    randomMessageId: string,
    accountId: string
  ): Promise<[ListRandomMessageItemResponse[], number]> => {
    const [result, total] = await Promise.all([
      this.randomMessageItemListerRepository.listRandomMessageItems(
        perPage,
        currentPage,
        query,
        randomMessageId,
        accountId
      ),
      this.randomMessageItemListerRepository.listRandomMessageItemTotal(
        query,
        randomMessageId,
        accountId
      ),
    ]);

    return [result, total];
  };

  createRandomMessageItem = async (input: {
    random_message_id: string;
    account_id: string;
    message: string;
    status: string;
    type: string;
    attachment_url?: string | null;
    mimetype?: string | null;
    duration?: number | null;
    width?: number | null;
    height?: number | null;
  }): Promise<string | null> => {
    return this.randomMessageItemCreatorRepository.createRandomMessageItem(
      input
    );
  };

  viewRandomMessageItemById = async (
    randomMessageItemId: string,
    randomMessageId: string,
    accountId: string
  ): Promise<ViewRandomMessageItemResponse | null> => {
    return this.randomMessageItemViewerRepository.viewRandomMessageItemById(
      randomMessageItemId,
      randomMessageId,
      accountId
    );
  };

  updateRandomMessageItemById = async (input: {
    random_message_item_id: string;
    random_message_id: string;
    account_id: string;
    message?: string | null;
    status?: string | null;
    type?: string | null;
    attachment_url?: string | null;
    mimetype?: string | null;
    duration?: number | null;
    width?: number | null;
    height?: number | null;
  }): Promise<boolean> => {
    return this.randomMessageItemUpdaterRepository.updateRandomMessageItemById(
      input
    );
  };

  deleteRandomMessageItemById = async (
    randomMessageItemId: string,
    randomMessageId: string,
    accountId: string
  ): Promise<boolean> => {
    return this.randomMessageItemDeleterRepository.deleteRandomMessageItemById(
      randomMessageItemId,
      randomMessageId,
      accountId
    );
  };
}
