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

function isDefined(
  condition: SQLWrapper | undefined
): condition is SQLWrapper {
  return Boolean(condition);
}

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

    if (!query.search) {
      return filters;
    }

    const searchTerm = query.search.trim();
    if (searchTerm.length === 0) {
      return filters;
    }

    const conditions: (SQLWrapper | undefined)[] = [
      ilike(contactGroup.name, `%${searchTerm}%`),
      ilike(contactGroup.description, `%${searchTerm}%`),
    ];

    const validConditions = conditions.filter(isDefined);

    if (validConditions.length) {
      const combined = or(...validConditions);
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
    const accountCondition = isAdministrator
      ? undefined
      : eq(contactGroup.account_id, accountId);

    const result = await this.db.query.contactGroup.findMany({
      where: and(isNull(contactGroup.deleted_at), ...filters, accountCondition),
      with: {
        cga: {
          columns: {
            account_id: true,
            name: true,
          },
        },
        cgaa: {
          with: {
            cga: {
              columns: {
                contact_id: true,
                name: true,
                phone_partial: true,
              },
              with: {
                clt: {
                  columns: {
                    label_template_id: true,
                    label: true,
                    color: true,
                  },
                },
              },
            },
          },
        },
      },
      columns: {
        contact_group_id: true,
        name: true,
        description: true,
        created_at: true,
      },
      limit: perPage,
      offset: (currentPage - 1) * perPage,
    });

    if (!result) {
      return [];
    }

    return result.map((item) => ({
      contact_group_id: item.contact_group_id,
      account: {
        account_id: item.cga.account_id,
        name: item.cga.name,
      },
      name: item.name,
      description: item.description,
      contacts: item.cgaa.map((contactGroupAssignment) => ({
        contact_id: contactGroupAssignment.cga.contact_id,
        name: contactGroupAssignment.cga.name,
        phone_partial: contactGroupAssignment.cga.phone_partial,
        label_template: contactGroupAssignment.cga.clt
          ? {
              label_template_id:
                contactGroupAssignment.cga.clt.label_template_id,
              label: contactGroupAssignment.cga.clt.label,
              color: contactGroupAssignment.cga.clt.color,
            }
          : null,
      })),
      created_at: item.created_at,
    }));
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
