import * as schema from '@core/models';
import {
  contact,
  contactChannel,
  labelTemplate,
  contactLabelTemplate,
} from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  isNull,
  notExists,
  or,
  SQL,
  SQLWrapper,
  sql,
  inArray,
} from 'drizzle-orm';
import { ListChatContactsResponse } from '@core/schema/chat/listContacts/response.schema';
import { ListChatContactsRequest } from '@core/schema/chat/listContacts/request.schema';
import { isDefinedFilter } from '@core/common/functions/isDefinedFilter';

@injectable()
export class ChatContactListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  private readonly buildSearchConditions = (
    searchTerm: string
  ): SQLWrapper[] => {
    const searchWords = searchTerm
      .trim()
      .split(/\s+/)
      .filter((word) => word.length > 0);
    const hasMultipleWords = searchWords.length > 1;

    const rawConditions: Array<SQLWrapper | undefined> = [
      searchTerm ? ilike(contact.name, `%${searchTerm}%`) : undefined,
      searchTerm ? ilike(contact.last_name, `%${searchTerm}%`) : undefined,
      hasMultipleWords
        ? and(
            ilike(contact.name, `%${searchWords[0]}%`),
            ilike(contact.last_name, `%${searchWords[1]}%`)
          )
        : undefined,
      hasMultipleWords
        ? and(
            ilike(contact.name, `%${searchWords[1]}%`),
            ilike(contact.last_name, `%${searchWords[0]}%`)
          )
        : undefined,
      searchTerm
        ? ilike(
            sql`CONCAT(COALESCE(${contact.name}, ''), ' ', COALESCE(${contact.last_name}, ''))`,
            `%${searchTerm}%`
          )
        : undefined,
      searchTerm ? ilike(contact.nickname, `%${searchTerm}%`) : undefined,
      searchTerm ? ilike(contact.email_partial, `%${searchTerm}%`) : undefined,
      searchTerm ? ilike(contact.phone_partial, `%${searchTerm}%`) : undefined,
      searchTerm
        ? inArray(
            contact.contact_id,
            this.dbRo
              .select({ contact_id: contactLabelTemplate.contact_id })
              .from(contactLabelTemplate)
              .innerJoin(
                labelTemplate,
                eq(
                  labelTemplate.label_template_id,
                  contactLabelTemplate.label_template_id
                )
              )
              .where(
                and(
                  ilike(labelTemplate.label, `%${searchTerm}%`),
                  isNull(labelTemplate.deleted_at)
                )
              )
          )
        : undefined,
    ];

    const conditions = rawConditions.filter(isDefinedFilter);

    return conditions.length > 0 ? [or(...conditions) as SQLWrapper] : [];
  };

  private readonly buildAdvancedFilters = (
    filters: Omit<ListChatContactsRequest, 'current_page' | 'per_page'>,
    emailHash: string | null,
    phoneHashes: string[] | null,
    documentHash: string | null
  ): SQLWrapper[] => {
    const filterConditions: Array<SQLWrapper | undefined> = [];

    if (filters.filter_label_template_id) {
      filterConditions.push(
        inArray(
          contact.contact_id,
          this.dbRo
            .select({ contact_id: contactLabelTemplate.contact_id })
            .from(contactLabelTemplate)
            .innerJoin(
              labelTemplate,
              eq(
                labelTemplate.label_template_id,
                contactLabelTemplate.label_template_id
              )
            )
            .where(
              and(
                eq(
                  contactLabelTemplate.label_template_id,
                  filters.filter_label_template_id
                ),
                isNull(labelTemplate.deleted_at)
              )
            )
        )
      );
    }

    if (filters.filter_phone_ddi) {
      filterConditions.push(eq(contact.phone_ddi, filters.filter_phone_ddi));
    }

    if (filters.filter_phone && phoneHashes && phoneHashes.length > 0) {
      filterConditions.push(inArray(contact.phone_c, phoneHashes));
    }

    if (filters.filter_name) {
      filterConditions.push(ilike(contact.name, `%${filters.filter_name}%`));
    }

    if (filters.filter_last_name) {
      filterConditions.push(
        ilike(contact.last_name, `%${filters.filter_last_name}%`)
      );
    }

    if (filters.filter_nickname) {
      filterConditions.push(
        ilike(contact.nickname, `%${filters.filter_nickname}%`)
      );
    }

    if (filters.filter_email && emailHash) {
      filterConditions.push(eq(contact.email_c, emailHash));
    }

    if (filters.filter_birthday) {
      filterConditions.push(
        sql`DATE(${contact.birthday}) = DATE(${sql.raw(`'${filters.filter_birthday}'`)}::timestamp)`
      );
    }

    if (filters.filter_document && documentHash) {
      filterConditions.push(eq(contact.document_c, documentHash));
    }

    if (filters.filter_user_id) {
      filterConditions.push(eq(contact.user_id, filters.filter_user_id));
    }

    if (
      filters.filter_is_valided !== null &&
      filters.filter_is_valided !== undefined
    ) {
      filterConditions.push(eq(contact.is_valided, filters.filter_is_valided));
    }

    return filterConditions.filter(isDefinedFilter);
  };

  private readonly buildOrderBy = (
    sortField?: string | null,
    sortOrder?: string | null
  ): SQL => {
    const order = sortOrder === 'desc' ? desc : asc;

    if (sortField === 'name') {
      return order(contact.name);
    }
    if (sortField === 'last_name') {
      return order(contact.last_name);
    }
    if (sortField === 'nickname') {
      return order(contact.nickname);
    }
    if (sortField === 'email') {
      return order(contact.email_partial);
    }
    if (sortField === 'phone') {
      return order(contact.phone_partial);
    }
    if (sortField === 'birthday') {
      return order(contact.birthday);
    }

    return asc(contact.name);
  };

  listChatContacts = async (
    perPage: number,
    currentPage: number,
    accountId: string,
    query?: ListChatContactsRequest,
    emailHash?: string | null,
    phoneHashes?: string[] | null,
    documentHash?: string | null,
    allowedChannelIds: string[] = []
  ): Promise<ListChatContactsResponse[]> => {
    const contacts = await this.findContacts(
      accountId,
      perPage,
      currentPage,
      query,
      emailHash,
      phoneHashes,
      documentHash,
      allowedChannelIds
    );

    if (!contacts.length) {
      return [];
    }

    const contactIds = contacts.map((c) => c.contact_id);
    const labelsByContactId = await this.findLabelsByContactIds(contactIds);

    return this.buildListChatContactsResponse(contacts, labelsByContactId);
  };

  private readonly findContacts = async (
    accountId: string,
    perPage: number,
    currentPage: number,
    query: ListChatContactsRequest | undefined,
    emailHash: string | null | undefined,
    phoneHashes: string[] | null | undefined,
    documentHash: string | null | undefined,
    allowedChannelIds: string[] = []
  ) => {
    const whereConditions = this.buildWhereConditions(
      accountId,
      query,
      emailHash,
      phoneHashes,
      documentHash,
      allowedChannelIds
    );

    const result = await this.dbRo
      .select({
        contact_id: contact.contact_id,
        name: contact.name,
        last_name: contact.last_name,
        email_partial: contact.email_partial,
        phone_partial: contact.phone_partial,
        phone_ddi: contact.phone_ddi,
        photo: contact.photo,
        is_valided: contact.is_valided,
      })
      .from(contact)
      .where(and(...whereConditions))
      .orderBy(this.buildOrderBy(query?.sort_field, query?.sort_order))
      .limit(perPage)
      .offset((currentPage - 1) * perPage)
      .execute();

    return result;
  };

  private readonly buildChannelAccessCondition = (
    accountId: string,
    allowedChannelIds: string[]
  ): SQLWrapper | null => {
    if (allowedChannelIds.length === 0) {
      return null;
    }

    const contactHasNoChannels = notExists(
      this.dbRo
        .select()
        .from(contactChannel)
        .where(
          and(
            eq(contactChannel.contact_id, contact.contact_id),
            eq(contactChannel.account_id, accountId)
          )
        )
    );

    const contactHasAllowedChannel = inArray(
      contact.contact_id,
      this.dbRo
        .select({ contact_id: contactChannel.contact_id })
        .from(contactChannel)
        .where(
          and(
            eq(contactChannel.account_id, accountId),
            inArray(contactChannel.channel_id, allowedChannelIds)
          )
        )
    );

    return or(contactHasNoChannels, contactHasAllowedChannel) as SQLWrapper;
  };

  private readonly buildFilteredChannelCondition = (
    accountId: string,
    filterChannelId: string | undefined,
    allowedChannelIds: string[]
  ): SQLWrapper | null => {
    if (!filterChannelId) {
      return null;
    }

    if (
      allowedChannelIds.length > 0 &&
      !allowedChannelIds.includes(filterChannelId)
    ) {
      return sql`1 = 0`;
    }

    const contactHasNoChannels = notExists(
      this.dbRo
        .select()
        .from(contactChannel)
        .where(
          and(
            eq(contactChannel.contact_id, contact.contact_id),
            eq(contactChannel.account_id, accountId)
          )
        )
    );

    const contactHasFilteredChannel = inArray(
      contact.contact_id,
      this.dbRo
        .select({ contact_id: contactChannel.contact_id })
        .from(contactChannel)
        .where(
          and(
            eq(contactChannel.account_id, accountId),
            eq(contactChannel.channel_id, filterChannelId)
          )
        )
    );

    return or(contactHasNoChannels, contactHasFilteredChannel) as SQLWrapper;
  };

  private readonly buildWhereConditions = (
    accountId: string,
    query: ListChatContactsRequest | undefined,
    emailHash: string | null | undefined,
    phoneHashes: string[] | null | undefined,
    documentHash: string | null | undefined,
    allowedChannelIds: string[] = []
  ): SQLWrapper[] => {
    const whereConditions: SQLWrapper[] = [
      eq(contact.account_id, accountId),
      isNull(contact.deleted_at),
    ];

    const filteredChannelCondition = this.buildFilteredChannelCondition(
      accountId,
      query?.filter_channel_id,
      allowedChannelIds
    );
    if (filteredChannelCondition) {
      whereConditions.push(filteredChannelCondition);
    } else {
      const channelCondition = this.buildChannelAccessCondition(
        accountId,
        allowedChannelIds
      );

      if (channelCondition) {
        whereConditions.push(channelCondition);
      }
    }

    if (query?.search) {
      const searchConditions = this.buildSearchConditions(query.search);
      whereConditions.push(...searchConditions);
    }

    if (query) {
      const advancedFilters = this.buildAdvancedFilters(
        query,
        emailHash ?? null,
        phoneHashes ?? null,
        documentHash ?? null
      );
      whereConditions.push(...advancedFilters);
    }

    return whereConditions;
  };

  private readonly findLabelsByContactIds = async (
    contactIds: string[]
  ): Promise<
    Map<
      string,
      Array<{ label_template_id: string; label: string; color: string }>
    >
  > => {
    if (contactIds.length === 0) {
      return new Map();
    }

    const labelsResult = await this.dbRo
      .select({
        contact_id: contactLabelTemplate.contact_id,
        label_template_id: labelTemplate.label_template_id,
        label: labelTemplate.label,
        color: labelTemplate.color,
      })
      .from(contactLabelTemplate)
      .innerJoin(
        labelTemplate,
        eq(
          labelTemplate.label_template_id,
          contactLabelTemplate.label_template_id
        )
      )
      .where(
        and(
          inArray(contactLabelTemplate.contact_id, contactIds),
          isNull(labelTemplate.deleted_at)
        )
      )
      .execute();

    return this.buildLabelsMap(labelsResult);
  };

  private readonly buildLabelsMap = (
    labelsResult: Array<{
      contact_id: string;
      label_template_id: string;
      label: string;
      color: string;
    }>
  ): Map<
    string,
    Array<{ label_template_id: string; label: string; color: string }>
  > => {
    const labelsByContactId = new Map<
      string,
      Array<{ label_template_id: string; label: string; color: string }>
    >();

    for (const label of labelsResult) {
      const existing = labelsByContactId.get(label.contact_id) ?? [];
      existing.push({
        label_template_id: label.label_template_id,
        label: label.label,
        color: label.color,
      });
      labelsByContactId.set(label.contact_id, existing);
    }

    return labelsByContactId;
  };

  private readonly buildListChatContactsResponse = (
    contacts: Array<{
      contact_id: string;
      name: string;
      last_name: string | null;
      email_partial: string | null;
      phone_partial: string | null;
      phone_ddi: string | null;
      photo: string | null;
      is_valided: boolean | null;
    }>,
    labelsByContactId: Map<
      string,
      Array<{ label_template_id: string; label: string; color: string }>
    >
  ): ListChatContactsResponse[] => {
    return contacts.map((contactItem) => ({
      contact_id: contactItem.contact_id,
      name: contactItem.name,
      last_name: contactItem.last_name ?? null,
      email_partial: contactItem.email_partial ?? null,
      phone_partial: contactItem.phone_partial ?? null,
      phone_ddi: contactItem.phone_ddi ?? null,
      photo: contactItem.photo ?? null,
      is_valided: contactItem.is_valided ?? null,
      label_templates: labelsByContactId.get(contactItem.contact_id) ?? [],
    }));
  };

  listChatContactsTotal = async (
    accountId: string,
    query?: ListChatContactsRequest,
    emailHash?: string | null,
    phoneHashes?: string[] | null,
    documentHash?: string | null,
    allowedChannelIds: string[] = []
  ): Promise<number> => {
    const whereConditions = this.buildWhereConditions(
      accountId,
      query,
      emailHash,
      phoneHashes,
      documentHash,
      allowedChannelIds
    );

    const result = await this.dbRo
      .select({
        count: count(),
      })
      .from(contact)
      .where(and(...whereConditions))
      .execute();

    return result[0]?.count ?? 0;
  };
}
