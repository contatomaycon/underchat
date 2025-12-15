import * as schema from '@core/models';
import {
  schedule,
  account,
  worker,
  scheduledContact,
  contact,
  contactGroup,
} from '@core/models';
import { ViewScheduleResponse } from '@core/schema/schedule/viewSchedule/response.schema';
import { and, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';

@injectable()
export class ScheduleViewerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  private readonly getScheduleData = async (scheduleId: string) => {
    const scheduleResult = await this.db
      .select({
        schedule_id: schedule.schedule_id,
        account: {
          account_id: account.account_id,
          name: account.name,
        },
        worker: {
          worker_id: worker.worker_id,
          name: worker.name,
        },
        type: schedule.type,
        send_to: schedule.send_to,
        message: schedule.message,
        url: schedule.url,
        mimetype: schedule.mimetype,
        duration: schedule.duration,
        width: schedule.width,
        height: schedule.height,
        send_date: schedule.send_date,
        created_at: schedule.created_at,
        updated_at: schedule.updated_at,
      })
      .from(schedule)
      .leftJoin(account, eq(schedule.account_id, account.account_id))
      .leftJoin(worker, eq(schedule.worker_id, worker.worker_id))
      .where(eq(schedule.schedule_id, scheduleId))
      .execute();

    return scheduleResult[0] ?? null;
  };

  private readonly getScheduledContactsData = async (scheduleId: string) => {
    return await this.db
      .select({
        contact_id: contact.contact_id,
        contact_name: contact.name,
        contact_phone_partial: contact.phone_partial,
        contact_group_id: contactGroup.contact_group_id,
        contact_group_name: contactGroup.name,
      })
      .from(scheduledContact)
      .leftJoin(contact, eq(scheduledContact.contact_id, contact.contact_id))
      .leftJoin(
        contactGroup,
        eq(scheduledContact.contact_group_id, contactGroup.contact_group_id)
      )
      .where(eq(scheduledContact.schedule_id, scheduleId))
      .execute();
  };

  private readonly mapContactsFromScheduledContacts = (
    scheduledContactsResult: Awaited<
      ReturnType<typeof this.getScheduledContactsData>
    >
  ): ViewScheduleResponse['contacts'] => {
    const contactsList = scheduledContactsResult
      .filter((sc) => sc.contact_id)
      .map((sc) => ({
        contact_id: sc.contact_id!,
        name: sc.contact_name!,
        phone_partial: sc.contact_phone_partial ?? null,
      }));

    return contactsList.length > 0 ? contactsList : undefined;
  };

  private readonly mapContactGroupsFromScheduledContacts = (
    scheduledContactsResult: Awaited<
      ReturnType<typeof this.getScheduledContactsData>
    >
  ): ViewScheduleResponse['contact_groups'] => {
    const contactGroupsList = scheduledContactsResult
      .filter((sc) => sc.contact_group_id)
      .map((sc) => ({
        contact_group_id: sc.contact_group_id!,
        name: sc.contact_group_name!,
      }));

    return contactGroupsList.length > 0 ? contactGroupsList : undefined;
  };

  private readonly mapToResponse = (
    scheduleData: NonNullable<Awaited<ReturnType<typeof this.getScheduleData>>>,
    contacts?: ViewScheduleResponse['contacts'],
    contactGroups?: ViewScheduleResponse['contact_groups']
  ): ViewScheduleResponse => {
    return {
      schedule_id: scheduleData.schedule_id,
      account: {
        account_id: scheduleData.account?.account_id ?? '',
        name: scheduleData.account?.name ?? '',
      },
      worker: {
        worker_id: scheduleData.worker?.worker_id ?? '',
        name: scheduleData.worker?.name ?? '',
      },
      type: scheduleData.type,
      send_to: scheduleData.send_to,
      message: scheduleData.message ?? null,
      url: scheduleData.url ?? null,
      mimetype: scheduleData.mimetype ?? null,
      duration: scheduleData.duration ?? null,
      width: scheduleData.width ?? null,
      height: scheduleData.height ?? null,
      send_date: scheduleData.send_date,
      contacts,
      contact_groups: contactGroups,
      created_at: scheduleData.created_at ? scheduleData.created_at : null,
      updated_at: scheduleData.updated_at ? scheduleData.updated_at : null,
    };
  };

  viewScheduleById = async (
    scheduleId: string
  ): Promise<ViewScheduleResponse | null> => {
    const scheduleData = await this.getScheduleData(scheduleId);

    if (!scheduleData) {
      return null;
    }

    const scheduledContactsResult =
      await this.getScheduledContactsData(scheduleId);

    const contacts = this.mapContactsFromScheduledContacts(
      scheduledContactsResult
    );
    const contactGroups = this.mapContactGroupsFromScheduledContacts(
      scheduledContactsResult
    );

    return this.mapToResponse(scheduleData, contacts, contactGroups);
  };
}
