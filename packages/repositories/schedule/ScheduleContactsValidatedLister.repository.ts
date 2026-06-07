import * as schema from '@core/models';
import {
  scheduledContact,
  contact,
  contactGroupAssignment,
} from '@core/models';
import { and, eq, isNull, inArray } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { IScheduleContactValidated } from '@core/common/interfaces/IScheduleContactValidated';
import { IScheduledContactData } from '@core/common/interfaces/IScheduledContactData';
import { EScheduleSendTo } from '@core/common/enums/EScheduleSendTo';

@injectable()
export class ScheduleContactsValidatedListerRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  private async getScheduledContacts(
    scheduleId: string
  ): Promise<IScheduledContactData[]> {
    return this.dbRw
      .select({
        contact_id: scheduledContact.contact_id,
        contact_group_id: scheduledContact.contact_group_id,
      })
      .from(scheduledContact)
      .where(eq(scheduledContact.schedule_id, scheduleId))
      .execute();
  }

  private extractContactAndGroupIds(
    scheduledContacts: IScheduledContactData[]
  ): { contactIds: string[]; contactGroupIds: string[] } {
    const contactIds: string[] = [];
    const contactGroupIds: string[] = [];

    for (const sc of scheduledContacts) {
      if (sc.contact_id) {
        contactIds.push(sc.contact_id);
      }
      if (sc.contact_group_id) {
        contactGroupIds.push(sc.contact_group_id);
      }
    }

    return { contactIds, contactGroupIds };
  }

  private async getContactIdsFromGroups(
    contactGroupIds: string[]
  ): Promise<string[]> {
    if (contactGroupIds.length === 0) {
      return [];
    }

    const groupContacts = await this.dbRw
      .select({
        contact_id: contactGroupAssignment.contact_id,
      })
      .from(contactGroupAssignment)
      .where(inArray(contactGroupAssignment.contact_group_id, contactGroupIds))
      .execute();

    return groupContacts
      .map((gc) => gc.contact_id)
      .filter((id): id is string => id !== null);
  }

  private async getValidatedContacts(
    contactIds: string[],
    accountId?: string
  ): Promise<IScheduleContactValidated[]> {
    if (contactIds.length === 0 && !accountId) {
      return [];
    }

    const conditions = [isNull(contact.deleted_at)];

    if (accountId) {
      conditions.push(eq(contact.account_id, accountId));
    }

    if (contactIds.length > 0) {
      conditions.push(inArray(contact.contact_id, contactIds));
    }

    const contacts = await this.dbRw
      .select({
        contact_id: contact.contact_id,
        name: contact.name,
        nickname: contact.nickname,
        phone: contact.phone,
        phone_ddi: contact.phone_ddi,
        phone_partial: contact.phone_partial,
        is_valided: contact.is_valided,
      })
      .from(contact)
      .where(and(...conditions))
      .execute();

    return contacts.map((c) => ({
      contact_id: c.contact_id,
      name: c.name,
      nickname: c.nickname ?? null,
      phone: c.phone,
      phone_ddi: c.phone_ddi,
      phone_partial: c.phone_partial,
      is_validated: c.is_valided ?? false,
    }));
  }

  listValidatedContactsBySchedule = async (
    scheduleId: string,
    sendTo: string,
    accountId: string
  ): Promise<IScheduleContactValidated[]> => {
    if (sendTo === EScheduleSendTo.all) {
      const contacts = await this.getValidatedContacts([], accountId);
      return contacts;
    }

    const scheduledContacts = await this.getScheduledContacts(scheduleId);

    const { contactIds, contactGroupIds } =
      this.extractContactAndGroupIds(scheduledContacts);

    const contactsFromGroups =
      await this.getContactIdsFromGroups(contactGroupIds);

    const allContactIds = [
      ...contactIds,
      ...contactsFromGroups.filter((id) => !contactIds.includes(id)),
    ];

    const contacts = await this.getValidatedContacts(allContactIds, accountId);
    return contacts;
  };
}
