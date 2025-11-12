import * as schema from '@core/models';
import {
  contactGroup,
  contactGroupAssignment,
  contact,
  labelTemplate,
  account,
} from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import {
  and,
  asc,
  count,
  desc,
  eq,
  isNull,
  SQL,
  SQLWrapper,
  or,
  ilike,
} from 'drizzle-orm';
import { ESortOrder } from '@core/common/enums/ESortOrder';
import { ListContactGroupRequest } from '@core/schema/contactGroup/listContactGroup/request.schema';
import { ESortByContactGroup } from '@core/common/enums/ESortByContactGroup';
import { ListContactGroupResponse } from '@core/schema/contactGroup/listContactGroup/response.schema';

@injectable()
export class ContactGroupListerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  private readonly setOrders = (query: ListContactGroupRequest): SQL[] => {
    const orders: SQL[] = [];
    const sort = query.sort_by;

    if (!sort?.length) {
      orders.push(
        asc(contactGroup.created_at),
        desc(contactGroup.contact_group_id)
      );

      return orders;
    }

    for (const { key, order } of sort) {
      if (key !== ESortByContactGroup.name) continue;
      orders.push(
        order === ESortOrder.asc
          ? asc(contactGroup.name)
          : desc(contactGroup.name)
      );
    }

    return orders;
  };

  private readonly setFilters = (
    query: ListContactGroupRequest
  ): SQLWrapper[] => {
    const filters: SQLWrapper[] = [];

    if (query.name || query.description) {
      const conditions: (SQLWrapper | undefined)[] = [
        query.name ? ilike(contactGroup.name, `%${query.name}%`) : undefined,
        query.description
          ? ilike(contactGroup.description, `%${query.description}%`)
          : undefined,
      ];

      const combined = or(...conditions);

      if (combined) filters.push(combined);
    }

    return filters;
  };

  listContactGroups = async (
    perPage: number,
    currentPage: number,
    query: ListContactGroupRequest,
    isAdministrator: boolean,
    accountId: string
  ): Promise<ListContactGroupResponse[]> => {
    const filters = this.setFilters(query);
    const orders = this.setOrders(query);
    const accountCondition = isAdministrator
      ? undefined
      : eq(contactGroup.account_id, accountId);

    const queryBuilder = this.db
      .select({
        contact_group_id: contactGroup.contact_group_id,
        account: {
          account_id: account.account_id,
          name: account.name,
        },
        name: contactGroup.name,
        description: contactGroup.description,
        contacts: {
          contact_id: contact.contact_id,
          name: contact.name,
          phone_partial: contact.phone_partial,
        },
        label_template: {
          label_template_id: labelTemplate.label_template_id,
          label: labelTemplate.label,
          color: labelTemplate.color,
        },
        created_at: contactGroup.created_at,
      })
      .from(contactGroup)
      .innerJoin(account, eq(contactGroup.account_id, account.account_id))
      .leftJoin(
        contactGroupAssignment,
        eq(
          contactGroup.contact_group_id,
          contactGroupAssignment.contact_group_id
        )
      )
      .leftJoin(
        contact,
        eq(contactGroupAssignment.contact_id, contact.contact_id)
      )
      .leftJoin(
        labelTemplate,
        eq(contact.label_template_id, labelTemplate.label_template_id)
      )
      .where(
        and(accountCondition, isNull(contactGroup.deleted_at), ...filters)
      );

    if (orders.length) {
      queryBuilder.orderBy(...orders);
    }

    const result = await queryBuilder
      .limit(perPage)
      .offset((currentPage - 1) * perPage)
      .execute();

    if (!result?.length) {
      return [] as ListContactGroupResponse[];
    }

    return result.map((contactGroup) => ({
      contact_group_id: contactGroup.contact_group_id,
      account: {
        account_id: contactGroup.account?.account_id,
        name: contactGroup.account?.name,
      },
      contacts: contactGroup.contacts
        ? [
            {
              contact_id: contactGroup.contacts.contact_id,
              name: contactGroup.contacts.name,
              phone_partial: contactGroup.contacts.phone_partial,
            },
          ]
        : null,
      label_template: contactGroup.label_template
        ? {
            label_template_id: contactGroup.label_template.label_template_id,
            label: contactGroup.label_template.label,
            color: contactGroup.label_template.color,
          }
        : null,
      name: contactGroup.name,
      description: contactGroup.description ?? null,
      created_at: contactGroup.created_at,
    })) as ListContactGroupResponse[];
  };

  listContactGroupTotal = async (
    query: ListContactGroupRequest,
    isAdministrator: boolean,
    accountId: string
  ): Promise<number> => {
    const filters = this.setFilters(query);
    const accountCondition = isAdministrator
      ? undefined
      : eq(contactGroup.account_id, accountId);

    const result = await this.db
      .select({
        count: count(),
      })
      .from(contactGroup)
      .innerJoin(account, eq(contactGroup.account_id, account.account_id))
      .leftJoin(
        contactGroupAssignment,
        eq(
          contactGroup.contact_group_id,
          contactGroupAssignment.contact_group_id
        )
      )
      .leftJoin(
        contact,
        eq(contactGroupAssignment.contact_id, contact.contact_id)
      )
      .leftJoin(
        labelTemplate,
        eq(contact.label_template_id, labelTemplate.label_template_id)
      )
      .where(and(accountCondition, isNull(contactGroup.deleted_at), ...filters))
      .execute();

    return result[0]?.count ?? 0;
  };
}
