import * as schema from '@core/models';
import { schedule, scheduledContact } from '@core/models';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';
import { EScheduleSendTo } from '@core/common/enums/EScheduleSendTo';
import { PgTransaction } from 'drizzle-orm/pg-core';
import { ExtractTablesWithRelations } from 'drizzle-orm';
import { IOfficialWhatsappTemplateMessage } from '@core/common/interfaces/IOfficialWhatsappTemplate';

@injectable()
export class ScheduleCreatorRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

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

  private readonly insertSchedule = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    scheduleId: string,
    input: {
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
    }
  ): Promise<boolean> => {
    const baseValues: Record<string, unknown> = {
      schedule_id: scheduleId,
      account_id: input.account_id,
      worker_id: input.worker_id,
      type: input.type,
      send_to: input.send_to,
      send_speed: input.send_speed,
      message: input.message,
      url: input.url,
      official_template: input.official_template ?? null,
      send_date: input.send_date,
    };

    if (input.chatbot_id !== undefined) {
      baseValues.chatbot_id = input.chatbot_id;
    }

    if (input.mimetype !== null && input.mimetype !== undefined) {
      baseValues.mimetype = input.mimetype;
    }

    if (input.duration !== null && input.duration !== undefined) {
      baseValues.duration = input.duration;
    }

    if (input.width !== null && input.width !== undefined) {
      baseValues.width = input.width;
    }

    if (input.height !== null && input.height !== undefined) {
      baseValues.height = input.height;
    }

    const result = await tx
      .insert(schedule)
      .values(baseValues as typeof schedule.$inferInsert)
      .execute();

    return !!result;
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
    return this.dbRw.transaction(async (tx) => {
      const scheduleId = uuidv7();
      const success = await this.insertSchedule(tx, scheduleId, {
        ...input,
      });

      if (!success) {
        return null;
      }

      if (
        input.send_to === EScheduleSendTo.contacts &&
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
        input.send_to === EScheduleSendTo.contact_groups &&
        input.contact_group_ids &&
        input.contact_group_ids.length > 0
      ) {
        await this.createScheduledContactsForContactGroups(
          tx,
          scheduleId,
          input.contact_group_ids
        );
      }

      return scheduleId;
    });
  };
}
