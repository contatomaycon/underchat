import * as schema from '@core/models';
import { contactChannel, worker } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { ContactValidationOrigin } from '@core/common/types/ContactValidationOrigin';

export interface ContactValidationChannel {
  worker_id: string;
  worker_type_id: string;
}

export interface ContactValidationState {
  is_valided: boolean;
  validation_origin: ContactValidationOrigin | null;
}

@injectable()
export class ContactValidationPolicyRepository {
  constructor(
    // Validation scope is read during write flows and must observe recent
    // channel/contact mutations before granting or denying an assumption.
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  listContactChannelIds = async (
    accountId: string,
    contactId: string
  ): Promise<string[]> => {
    const result = await this.dbRw
      .select({ channel_id: contactChannel.channel_id })
      .from(contactChannel)
      .where(
        and(
          eq(contactChannel.account_id, accountId),
          eq(contactChannel.contact_id, contactId)
        )
      )
      .execute();

    return result.map(({ channel_id }) => channel_id);
  };

  listAccountChannels = async (
    accountId: string,
    channelIds?: string[]
  ): Promise<ContactValidationChannel[]> => {
    if (channelIds && channelIds.length === 0) {
      return [];
    }

    return this.dbRw
      .select({
        worker_id: worker.worker_id,
        worker_type_id: worker.worker_type_id,
      })
      .from(worker)
      .where(
        and(
          eq(worker.account_id, accountId),
          isNull(worker.deleted_at),
          channelIds ? inArray(worker.worker_id, channelIds) : undefined
        )
      )
      .execute();
  };

  viewValidationState = async (
    accountId: string,
    contactId: string
  ): Promise<ContactValidationState | null> => {
    const result = await this.dbRw
      .select({
        is_valided: schema.contact.is_valided,
        validation_origin: schema.contact.validation_origin,
      })
      .from(schema.contact)
      .where(
        and(
          eq(schema.contact.account_id, accountId),
          eq(schema.contact.contact_id, contactId),
          isNull(schema.contact.deleted_at)
        )
      )
      .limit(1)
      .execute();

    const state = result[0];
    if (!state) {
      return null;
    }

    return {
      is_valided: state.is_valided ?? false,
      validation_origin: state.validation_origin ?? null,
    };
  };
}
