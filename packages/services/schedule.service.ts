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
import { IUpdateSchedule } from '@core/interfaces/repositories/schedule/IUpdateSchedule';

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
    private readonly scheduleContactGroupsListerRepository: ScheduleContactGroupsListerRepository
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
    const [result, total] = await Promise.all([
      this.scheduleContactsListerRepository.listScheduleContacts(
        perPage,
        currentPage,
        query,
        accountId
      ),
      this.scheduleContactsListerRepository.listScheduleContactsTotal(
        query,
        accountId
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
}
