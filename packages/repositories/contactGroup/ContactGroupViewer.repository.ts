import * as schema from '@core/models';
import {
  contactGroup,
  contact,
  contactGroupAssignment,
  account,
} from '@core/models';
import { ViewContactGroupResponse } from '@core/schema/contactGroup/viewContactGroup/response.schema';
import { and, eq, isNull } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';

@injectable()
export class ContactGroupViewerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  viewContactGroupById = async (
    contactGroupId: string,
    accountId?: string
  ): Promise<ViewContactGroupResponse | null> => {
    const result = await this.dbRo
      .select({
        contact_group_id: contactGroup.contact_group_id,
        name: contactGroup.name,
        description: contactGroup.description,
        account: {
          account_id: account.account_id,
          name: account.name,
        },
        contacts: {
          contact_id: contact.contact_id,
          name: contact.name,
          phone_partial: contact.phone_partial,
        },
      })
      .from(contactGroup)
      .innerJoin(account, eq(contactGroup.account_id, account.account_id))
      .leftJoin(
        contactGroupAssignment,
        eq(
          contactGroupAssignment.contact_group_id,
          contactGroup.contact_group_id
        )
      )
      .leftJoin(
        contact,
        eq(contact.contact_id, contactGroupAssignment.contact_id)
      )
      .where(
        and(
          eq(contactGroup.contact_group_id, contactGroupId),
          accountId ? eq(contactGroup.account_id, accountId) : undefined,
          isNull(contactGroup.deleted_at)
        )
      )
      .execute();

    if (!result.length) {
      return null;
    }

    return {
      contact_group_id: result[0].contact_group_id,
      name: result[0].name,
      description: result[0].description,
      account: {
        account_id: result[0].account.account_id,
        name: result[0].account.name,
      },
      contacts: result[0].contacts
        ? result.map((item) => ({
            contact_id: item.contacts?.contact_id,
            name: item.contacts?.name,
            phone_partial: item.contacts?.phone_partial,
          }))
        : [],
    } as ViewContactGroupResponse;
  };
}
