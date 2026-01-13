import * as schema from '@core/models';
import {
  contactGroup,
  contactGroupAssignment,
  contact,
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
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
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

    if (conditions.length) {
      const combined = or(...conditions);
      if (combined) filters.push(combined);
    }

    return filters;
  };

  listContactGroups = async (
    perPage: number,
    currentPage: number,
    query: ListContactGroupRequest,
    accountId: string
  ): Promise<ListContactGroupResponse[]> => {
    const filters = this.setFilters(query);

    const result = await this.dbRo.query.contactGroup.findMany({
      where: and(
        eq(contactGroup.account_id, accountId),
        isNull(contactGroup.deleted_at),
        ...filters
      ),
      with: {
        cga: {
          columns: {
            account_id: true,
            name: true,
          },
        },
        cgt: {
          with: {
            cga: {
              columns: {
                contact_id: true,
                name: true,
                phone_partial: true,
              },
              with: {
                clt: {
                  with: {
                    ltt: {
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

    return result.map((item) => this.buildContactGroupResponse(item as any));
  };

  private readonly buildContactGroupResponse = (item: {
    contact_group_id: string;
    name: string;
    description: string | null;
    created_at: string | null;
    cga: {
      account_id: string;
      name: string;
    };
    cgt: Array<{
      cga: {
        contact_id: string;
        name: string;
        phone_partial: string | null;
        clt: Array<{
          ltt: {
            label_template_id: string;
            label: string;
            color: string;
          } | null;
        }>;
      };
    }>;
  }): ListContactGroupResponse => {
    return {
      contact_group_id: item.contact_group_id,
      account: {
        account_id: item.cga.account_id,
        name: item.cga.name,
      },
      name: item.name,
      description: item.description,
      contacts: item.cgt.map((contactGroupAssignmentItem) =>
        this.buildContactResponse(contactGroupAssignmentItem)
      ),
      created_at: item.created_at,
    };
  };

  private readonly buildContactResponse = (contactGroupAssignmentItem: {
    cga: {
      contact_id: string;
      name: string;
      phone_partial: string | null;
      clt: Array<{
        ltt: {
          label_template_id: string;
          label: string;
          color: string;
        } | null;
      }>;
    };
  }): {
    contact_id: string;
    name: string;
    phone_partial: string | null;
    label_templates: Array<{
      label_template_id: string;
      label: string;
      color: string;
    }>;
  } => {
    return {
      contact_id: contactGroupAssignmentItem.cga.contact_id,
      name: contactGroupAssignmentItem.cga.name,
      phone_partial: contactGroupAssignmentItem.cga.phone_partial,
      label_templates: this.formatLabelTemplates(
        contactGroupAssignmentItem.cga.clt
      ),
    };
  };

  private readonly formatLabelTemplates = (
    cltItems: Array<{
      ltt: {
        label_template_id: string;
        label: string;
        color: string;
      } | null;
    }>
  ): Array<{ label_template_id: string; label: string; color: string }> => {
    return cltItems
      .map((cltItem) => cltItem.ltt)
      .filter(
        (
          ltt
        ): ltt is { label_template_id: string; label: string; color: string } =>
          ltt !== null && ltt !== undefined
      )
      .map((ltt) => ({
        label_template_id: ltt.label_template_id,
        label: ltt.label,
        color: ltt.color,
      }));
  };

  listContactGroupTotal = async (
    query: ListContactGroupRequest,
    accountId: string
  ): Promise<number> => {
    const filters = this.setFilters(query);

    const result = await this.dbRo
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
      .where(
        and(
          eq(contactGroup.account_id, accountId),
          isNull(contactGroup.deleted_at),
          ...filters
        )
      )
      .execute();

    return result[0]?.count ?? 0;
  };
}
