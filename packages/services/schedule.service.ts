import { injectable } from 'tsyringe';
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
import { ListScheduleWorkersResponse } from '@core/schema/schedule/listScheduleWorkers/response.schema';
import { ScheduleContactsListerRepository } from '@core/repositories/schedule/ScheduleContactsLister.repository';
import { ListScheduleContactsRequest } from '@core/schema/schedule/listScheduleContacts/request.schema';
import { ListScheduleContactsResponse } from '@core/schema/schedule/listScheduleContacts/response.schema';
import { ScheduleContactGroupsListerRepository } from '@core/repositories/schedule/ScheduleContactGroupsLister.repository';
import { ListScheduleContactGroupsResponse } from '@core/schema/schedule/listScheduleContactGroups/response.schema';
import { ScheduleMessagesListerRepository } from '@core/repositories/schedule/ScheduleMessagesLister.repository';
import { ListScheduleMessagesRequest } from '@core/schema/schedule/listScheduleMessages/request.schema';
import { ListScheduleMessagesResponse } from '@core/schema/schedule/listScheduleMessages/response.schema';
import { IUpdateSchedule } from '@core/interfaces/repositories/schedule/IUpdateSchedule';
import { setPaginationData } from '@core/common/functions/createPaginationData';
import { EncryptService } from '@core/services/encrypt.service';
import { buildCandidates } from '@core/common/functions/buildCandidatesBR';
import { onlyDigits } from '@core/common/functions/onlyDigits';

@injectable()
export class ScheduleService {
  constructor(
    private readonly scheduleListerRepository: ScheduleListerRepository,
    private readonly scheduleCreatorRepository: ScheduleCreatorRepository,
    private readonly scheduleViewerExistsRepository: ScheduleViewerExistsRepository,
    private readonly scheduleViewerRepository: ScheduleViewerRepository,
    private readonly scheduleDeleterRepository: ScheduleDeleterRepository,
    private readonly scheduleUpdaterRepository: ScheduleUpdaterRepository,
    private readonly scheduleWorkersListerRepository: ScheduleWorkersListerRepository,
    private readonly scheduleContactsListerRepository: ScheduleContactsListerRepository,
    private readonly scheduleContactGroupsListerRepository: ScheduleContactGroupsListerRepository,
    private readonly scheduleMessagesListerRepository: ScheduleMessagesListerRepository,
    private readonly encryptService: EncryptService
  ) {}

  listSchedules = async (
    perPage: number,
    currentPage: number,
    query: ListScheduleRequest,
    accountId: string
  ): Promise<[ListScheduleResponse[], number]> => {
    const [result, total] = await Promise.all([
      this.scheduleListerRepository.listSchedules(
        perPage,
        currentPage,
        query,
        accountId
      ),
      this.scheduleListerRepository.listScheduleTotal(query, accountId),
    ]);

    return [result, total];
  };

  createSchedule = async (input: {
    account_id: string;
    worker_id: string;
    type: string;
    send_to: string;
    message: string | null;
    url: string | null;
    mimetype: string | null;
    duration: number | null;
    width: number | null;
    height: number | null;
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
