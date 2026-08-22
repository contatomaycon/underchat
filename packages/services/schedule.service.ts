import { injectable, inject } from 'tsyringe';
import { ScheduleListerRepository } from '@core/repositories/schedule/ScheduleLister.repository';
import { ListScheduleRequest } from '@core/schema/schedule/listSchedule/request.schema';
import { ListScheduleResponse } from '@core/schema/schedule/listSchedule/response.schema';
import { ScheduleCreatorRepository } from '@core/repositories/schedule/ScheduleCreator.repository';
import { ScheduleViewerExistsRepository } from '@core/repositories/schedule/ScheduleViewerExists.repository';
import { ScheduleViewerRepository } from '@core/repositories/schedule/ScheduleViewer.repository';
import { ViewScheduleResponse } from '@core/schema/schedule/viewSchedule/response.schema';
import { ScheduleDeleterRepository } from '@core/repositories/schedule/ScheduleDeleter.repository';
import { ScheduleUpdaterRepository } from '@core/repositories/schedule/ScheduleUpdater.repository';
import { ScheduleWorkersListerRepository } from '@core/repositories/schedule/ScheduleWorkersLister.repository';
import { ScheduleChatbotsListerRepository } from '@core/repositories/schedule/ScheduleChatbotsLister.repository';
import { ListScheduleWorkersResponse } from '@core/schema/schedule/listScheduleWorkers/response.schema';
import { ListScheduleChatbotsResponse } from '@core/schema/schedule/listScheduleChatbots/response.schema';
import { ScheduleContactsListerRepository } from '@core/repositories/schedule/ScheduleContactsLister.repository';
import { ListScheduleContactsRequest } from '@core/schema/schedule/listScheduleContacts/request.schema';
import { ListScheduleContactsResponse } from '@core/schema/schedule/listScheduleContacts/response.schema';
import { ScheduleContactGroupsListerRepository } from '@core/repositories/schedule/ScheduleContactGroupsLister.repository';
import { ListScheduleContactGroupsResponse } from '@core/schema/schedule/listScheduleContactGroups/response.schema';
import { ScheduleMessagesListerRepository } from '@core/repositories/schedule/ScheduleMessagesLister.repository';
import { ListScheduleMessagesRequest } from '@core/schema/schedule/listScheduleMessages/request.schema';
import { ListScheduleMessagesResponse } from '@core/schema/schedule/listScheduleMessages/response.schema';
import { IUpdateSchedule } from '@core/interfaces/repositories/schedule/IUpdateSchedule';
import { ScheduleControlRepository } from '@core/repositories/schedule/ScheduleControl.repository';
import { setPaginationData } from '@core/common/functions/createPaginationData';
import { EncryptService } from '@core/services/encrypt.service';
import { buildCandidates } from '@core/common/functions/buildCandidatesBR';
import { onlyDigits } from '@core/common/functions/onlyDigits';
import { EScheduleStatus } from '@core/common/enums/EScheduleStatus';
import { IOfficialWhatsappTemplateMessage } from '@core/common/interfaces/IOfficialWhatsappTemplate';

@injectable()
export class ScheduleService {
  constructor(
    @inject(ScheduleListerRepository)
    private readonly scheduleListerRepository: ScheduleListerRepository,
    @inject(ScheduleCreatorRepository)
    private readonly scheduleCreatorRepository: ScheduleCreatorRepository,
    @inject(ScheduleViewerExistsRepository)
    private readonly scheduleViewerExistsRepository: ScheduleViewerExistsRepository,
    @inject(ScheduleViewerRepository)
    private readonly scheduleViewerRepository: ScheduleViewerRepository,
    @inject(ScheduleDeleterRepository)
    private readonly scheduleDeleterRepository: ScheduleDeleterRepository,
    @inject(ScheduleUpdaterRepository)
    private readonly scheduleUpdaterRepository: ScheduleUpdaterRepository,
    @inject(ScheduleWorkersListerRepository)
    private readonly scheduleWorkersListerRepository: ScheduleWorkersListerRepository,
    @inject(ScheduleChatbotsListerRepository)
    private readonly scheduleChatbotsListerRepository: ScheduleChatbotsListerRepository,
    @inject(ScheduleContactsListerRepository)
    private readonly scheduleContactsListerRepository: ScheduleContactsListerRepository,
    @inject(ScheduleContactGroupsListerRepository)
    private readonly scheduleContactGroupsListerRepository: ScheduleContactGroupsListerRepository,
    @inject(ScheduleMessagesListerRepository)
    private readonly scheduleMessagesListerRepository: ScheduleMessagesListerRepository,
    @inject(ScheduleControlRepository)
    private readonly scheduleControlRepository: ScheduleControlRepository,
    @inject(EncryptService)
    private readonly encryptService: EncryptService
  ) {}

  listSchedules = async (
    perPage: number,
    currentPage: number,
    query: ListScheduleRequest,
    accountId: string,
    allowedWorkerIds?: readonly string[]
  ): Promise<[ListScheduleResponse[], number]> => {
    const [result, total] = await Promise.all([
      this.scheduleListerRepository.listSchedules(
        perPage,
        currentPage,
        query,
        accountId,
        allowedWorkerIds
      ),
      this.scheduleListerRepository.listScheduleTotal(
        query,
        accountId,
        allowedWorkerIds
      ),
    ]);

    if (!result.length) {
      return [result, total];
    }

    const scheduleIds = result.map((item) => item.schedule_id);
    const failedBySchedule =
      await this.scheduleMessagesListerRepository.countFailedMessagesByScheduleIds(
        scheduleIds,
        accountId
      );

    const enrichedResult = result.map((item) => {
      const failedMessagesCount = failedBySchedule[item.schedule_id] ?? 0;

      return {
        ...item,
        failed_messages_count: failedMessagesCount,
        has_failed_messages: failedMessagesCount > 0,
      };
    });

    return [enrichedResult, total];
  };

  createSchedule = async (input: {
    account_id: string;
    worker_id: string;
    type: string;
    send_to: string;
    send_speed: string;
    chatbot_id?: string | null;
    message: string | null;
    url: string | null;
    mimetype: string | null;
    duration: number | null;
    width: number | null;
    height: number | null;
    official_template?: IOfficialWhatsappTemplateMessage | null;
    send_date: string;
    contact_ids?: string[];
    contact_group_ids?: string[];
  }): Promise<string | null> => {
    return this.scheduleCreatorRepository.createSchedule(input);
  };

  existsScheduleById = async (scheduleId: string): Promise<boolean> => {
    return this.scheduleViewerExistsRepository.existsScheduleById(scheduleId);
  };

  viewScheduleById = async (
    scheduleId: string
  ): Promise<ViewScheduleResponse | null> => {
    return this.scheduleViewerRepository.viewScheduleById(scheduleId);
  };

  deleteScheduleById = async (scheduleId: string): Promise<boolean> => {
    return this.scheduleDeleterRepository.deleteScheduleById(scheduleId);
  };

  findScheduleControlById = async (
    scheduleId: string,
    accountId: string
  ): Promise<{
    schedule_id: string;
    account_id: string;
    worker_id: string;
    status: EScheduleStatus;
    send_date: string;
  } | null> => {
    return this.scheduleControlRepository.findByIdAndAccount(
      scheduleId,
      accountId
    );
  };

  getScheduleStatusById = async (
    scheduleId: string
  ): Promise<EScheduleStatus | null> => {
    return this.scheduleControlRepository.getScheduleStatusById(scheduleId);
  };

  startScheduleNow = async (scheduleId: string): Promise<boolean> => {
    return this.scheduleControlRepository.startScheduleNow(scheduleId);
  };

  pauseSchedule = async (scheduleId: string): Promise<boolean> => {
    return this.scheduleControlRepository.pauseSchedule(scheduleId);
  };

  cancelSchedule = async (scheduleId: string): Promise<boolean> => {
    return this.scheduleControlRepository.cancelSchedule(scheduleId);
  };

  updateScheduleById = async (
    scheduleId: string,
    input: IUpdateSchedule
  ): Promise<boolean> => {
    return this.scheduleUpdaterRepository.updateScheduleById(scheduleId, input);
  };

  listScheduleWorkers = async (
    accountId: string
  ): Promise<ListScheduleWorkersResponse[]> => {
    return this.scheduleWorkersListerRepository.listScheduleWorkers(accountId);
  };

  listScheduleChatbots = async (
    accountId: string
  ): Promise<ListScheduleChatbotsResponse[]> => {
    return this.scheduleChatbotsListerRepository.listScheduleChatbots(
      accountId
    );
  };

  existsChatbotInAccount = async (
    chatbotId: string,
    accountId: string
  ): Promise<boolean> => {
    return this.scheduleChatbotsListerRepository.existsByChatbotIdAndAccount(
      chatbotId,
      accountId
    );
  };

  listScheduleContacts = async (
    perPage: number,
    currentPage: number,
    query: ListScheduleContactsRequest,
    accountId: string
  ): Promise<[ListScheduleContactsResponse[], number]> => {
    let searchHashes: string | null = null;
    let searchHashesArray: string[] | null = null;

    if (query.search) {
      const searchDigits = onlyDigits(query.search);
      if (searchDigits.length >= 3) {
        const candidates = buildCandidates(query.search);
        searchHashesArray = candidates.map((candidate) =>
          this.encryptService.encrypt(candidate)
        );
        searchHashes = this.encryptService.encrypt(query.search);
      }

      if (searchDigits.length < 3) {
        searchHashes = this.encryptService.encrypt(query.search);
      }
    }

    const [result, total] = await Promise.all([
      this.scheduleContactsListerRepository.listScheduleContacts(
        perPage,
        currentPage,
        query,
        accountId,
        searchHashes,
        searchHashesArray
      ),
      this.scheduleContactsListerRepository.listScheduleContactsTotal(
        query,
        accountId,
        searchHashes,
        searchHashesArray
      ),
    ]);

    return [result, total];
  };

  listScheduleContactGroups = async (
    accountId: string
  ): Promise<ListScheduleContactGroupsResponse[]> => {
    return this.scheduleContactGroupsListerRepository.listScheduleContactGroups(
      accountId
    );
  };

  listScheduleMessages = async (
    query: ListScheduleMessagesRequest,
    accountId: string
  ): Promise<ListScheduleMessagesResponse | null> => {
    const currentPage = query.current_page ?? 1;
    const perPage = query.per_page ?? 50;

    const [messages, total] =
      await this.scheduleMessagesListerRepository.listScheduleMessages(
        query.schedule_id,
        accountId,
        currentPage,
        perPage
      );

    const pagings = setPaginationData(
      messages.length,
      total,
      perPage,
      currentPage
    );

    return {
      results: messages,
      pagings,
    };
  };
}
