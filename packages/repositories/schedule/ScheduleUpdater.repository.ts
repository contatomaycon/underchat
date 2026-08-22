import * as schema from '@core/models';
import { schedule, scheduledContact } from '@core/models';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq, ExtractTablesWithRelations } from 'drizzle-orm';
import { EScheduleSendTo } from '@core/common/enums/EScheduleSendTo';
import { EScheduleSendSpeed } from '@core/common/enums/EScheduleSendSpeed';
import { EScheduleType } from '@core/common/enums/EScheduleType';
import { v7 as uuidv7 } from 'uuid';
import { currentTime } from '@core/common/functions/currentTime';
import { IUpdateSchedule } from '@core/interfaces/repositories/schedule/IUpdateSchedule';
import { PgTransaction } from 'drizzle-orm/pg-core';

@injectable()
export class ScheduleUpdaterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  private readonly prepareUpdateData = (
    input: IUpdateSchedule
  ): Partial<typeof schedule.$inferInsert> => {
    const updateData: Partial<typeof schedule.$inferInsert> = {
      updated_at: currentTime(),
    };

    if (input.worker_id !== undefined && input.worker_id !== null) {
      updateData.worker_id = input.worker_id;
    }

    if (input.type !== undefined && input.type !== null) {
      updateData.type = input.type as EScheduleType;
    }

    if (input.send_to !== undefined && input.send_to !== null) {
      updateData.send_to = input.send_to as EScheduleSendTo;
    }

    if (input.send_speed !== undefined && input.send_speed !== null) {
      updateData.send_speed = input.send_speed as EScheduleSendSpeed;
    }

    if (input.chatbot_id !== undefined) {
      updateData.chatbot_id = input.chatbot_id ?? null;
    }

    if (input.message !== undefined) {
      updateData.message = input.message ?? null;
    }

    if (input.url !== undefined) {
      updateData.url = input.url ?? null;
    }

    if (input.mimetype !== undefined) {
      updateData.mimetype = input.mimetype ?? null;
    }

    if (input.duration !== undefined) {
      updateData.duration = input.duration ?? null;
    }

    if (input.width !== undefined) {
      updateData.width = input.width ?? null;
    }

    if (input.height !== undefined) {
      updateData.height = input.height ?? null;
    }

    if (input.official_template !== undefined) {
      updateData.official_template = input.official_template ?? null;
    }

    if (input.send_date !== undefined && input.send_date !== null) {
      updateData.send_date = input.send_date;
    }

    return updateData;
  };

  private readonly deleteExistingScheduledContacts = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    scheduleId: string
  ): Promise<void> => {
    await tx
      .delete(scheduledContact)
      .where(eq(scheduledContact.schedule_id, scheduleId))
      .execute();
  };

  private readonly createScheduledContactsForContacts = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    scheduleId: string,
    contactIds: string[]
  ): Promise<void> => {
    const values = contactIds.map((contactId) => ({
      scheduled_contact_id: uuidv7(),
      schedule_id: scheduleId,
      contact_id: contactId,
      contact_group_id: null,
    }));

    await tx.insert(scheduledContact).values(values).execute();
  };

  private readonly createScheduledContactsForContactGroups = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    scheduleId: string,
    contactGroupIds: string[]
  ): Promise<void> => {
    const values = contactGroupIds.map((contactGroupId) => ({
      scheduled_contact_id: uuidv7(),
      schedule_id: scheduleId,
      contact_id: null,
      contact_group_id: contactGroupId,
    }));

    await tx.insert(scheduledContact).values(values).execute();
  };

  private readonly updateSchedule = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    scheduleId: string,
    updateData: Partial<typeof schedule.$inferInsert>
  ): Promise<boolean> => {
    const result = await tx
      .update(schedule)
      .set(updateData)
      .where(eq(schedule.schedule_id, scheduleId))
      .execute();

    return result.rowCount === 1;
  };

  updateScheduleById = async (
    scheduleId: string,
    input: IUpdateSchedule
  ): Promise<boolean> => {
    return this.dbRw.transaction(async (tx) => {
      const updateData = this.prepareUpdateData(input);
      const hasRecipientChanges =
        input.contact_ids !== undefined ||
        input.contact_group_ids !== undefined ||
        input.send_to === EScheduleSendTo.all;
      const recipientType =
        input.send_to === EScheduleSendTo.contacts ||
        input.send_to === EScheduleSendTo.contact_groups ||
        input.send_to === EScheduleSendTo.all
          ? input.send_to
          : input.contact_ids !== undefined
            ? EScheduleSendTo.contacts
            : input.contact_group_ids !== undefined
              ? EScheduleSendTo.contact_groups
              : undefined;

      if (
        input.send_to === undefined &&
        (recipientType === EScheduleSendTo.contacts ||
          recipientType === EScheduleSendTo.contact_groups)
      ) {
        updateData.send_to = recipientType;
      }

      if (hasRecipientChanges) {
        await this.deleteExistingScheduledContacts(tx, scheduleId);
      }

      if (
        hasRecipientChanges &&
        recipientType === EScheduleSendTo.contacts &&
        input.contact_ids &&
        input.contact_ids.length > 0
      ) {
        await this.createScheduledContactsForContacts(
          tx,
          scheduleId,
          input.contact_ids
        );
      }

      if (
        hasRecipientChanges &&
        recipientType === EScheduleSendTo.contact_groups &&
        input.contact_group_ids &&
        input.contact_group_ids.length > 0
      ) {
        await this.createScheduledContactsForContactGroups(
          tx,
          scheduleId,
          input.contact_group_ids
        );
      }

      return this.updateSchedule(tx, scheduleId, updateData);
    });
  };
}
