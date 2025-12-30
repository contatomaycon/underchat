import * as schema from '@core/models';
import { contact } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, count, eq, inArray, isNull, ne, or } from 'drizzle-orm';

@injectable()
export class ContactExistsByEmailAndPhoneRepository {
  constructor(
    @inject('DatabaseRw') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  existsContactByEmailAndPhone = async (
    emailC: string | null,
    phoneC: string | null,
    excludeContactId?: string | null
  ): Promise<boolean> => {
    if (!emailC && !phoneC) {
      return false;
    }

    const emailCondition = emailC ? eq(contact.email_c, emailC) : undefined;
    const phoneCondition = phoneC ? eq(contact.phone_c, phoneC) : undefined;

    const searchConditions = [emailCondition, phoneCondition].filter(
      (condition): condition is typeof emailCondition => condition !== undefined
    );

    if (searchConditions.length === 0) {
      return false;
    }

    const conditions = [isNull(contact.deleted_at), or(...searchConditions)];

    if (excludeContactId) {
      conditions.push(ne(contact.contact_id, excludeContactId));
    }

    const result = await this.db
      .select({
        total: count(),
      })
      .from(contact)
      .where(and(...conditions))
      .execute();

    if (!result.length) {
      return false;
    }

    return result[0].total > 0;
  };

  existsContactByEmail = async (
    accountId: string,
    emailC: string,
    excludeContactId?: string | null
  ): Promise<boolean> => {
    const conditions = [
      isNull(contact.deleted_at),
      eq(contact.account_id, accountId),
      eq(contact.email_c, emailC),
    ];

    if (excludeContactId) {
      conditions.push(ne(contact.contact_id, excludeContactId));
    }

    const result = await this.db
      .select({
        total: count(),
      })
      .from(contact)
      .where(and(...conditions))
      .execute();

    if (!result.length) {
      return false;
    }

    return result[0].total > 0;
  };

  existsContactByPhone = async (
    accountId: string,
    phonesC: string[],
    excludeContactId?: string | null
  ): Promise<boolean> => {
    const conditions = [
      isNull(contact.deleted_at),
      eq(contact.account_id, accountId),
      inArray(contact.phone_c, phonesC),
    ];

    if (excludeContactId) {
      conditions.push(ne(contact.contact_id, excludeContactId));
    }

    const result = await this.db
      .select({
        total: count(),
      })
      .from(contact)
      .where(and(...conditions))
      .execute();

    if (!result.length) {
      return false;
    }

    return result[0].total > 0;
  };
}
