import * as schema from '@core/models';
import { whatsappMessageTemplate } from '@core/models';
import { currentTime } from '@core/common/functions/currentTime';
import {
  CreateWhatsappTemplateRequest,
  ListWhatsappTemplatesQuery,
  WhatsappTemplateComponent,
  WhatsappTemplateResponse,
} from '@core/schema/worker/whatsappOfficialTemplate';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import {
  and,
  asc,
  count,
  eq,
  ilike,
  isNull,
  or,
  SQLWrapper,
} from 'drizzle-orm';

export interface WhatsappTemplateUpsertInput {
  whatsapp_message_template_id: string;
  account_id: string;
  worker_id: string;
  worker_whatsapp_official_connection_id: string | null;
  waba_id: string;
  meta_template_id: string | null;
  name: string;
  language: string;
  category: string;
  sub_category: string | null;
  parameter_format: string | null;
  components: WhatsappTemplateComponent[];
  status: string;
  quality_score: string | null;
  rejected_reason: string | null;
  message_send_ttl_seconds: number | null;
  meta_payload: Record<string, unknown> | null;
  origin: 'meta' | 'underchat';
  sync_state: string;
  is_active: boolean;
  last_synced_at?: string | null;
  last_error?: string | null;
}

export interface WhatsappTemplateUpdateInput extends Partial<CreateWhatsappTemplateRequest> {
  meta_template_id?: string | null;
  status?: string;
  quality_score?: string | null;
  rejected_reason?: string | null;
  meta_payload?: Record<string, unknown> | null;
  origin?: 'meta' | 'underchat';
  sync_state?: string;
  is_active?: boolean;
  last_synced_at?: string | null;
  last_error?: string | null;
}

@injectable()
export class WhatsappMessageTemplateRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>,
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  private mapTemplate = (
    row: typeof whatsappMessageTemplate.$inferSelect
  ): WhatsappTemplateResponse => ({
    whatsapp_message_template_id: row.whatsapp_message_template_id,
    account_id: row.account_id,
    worker_id: row.worker_id,
    waba_id: row.waba_id,
    meta_template_id: row.meta_template_id ?? null,
    name: row.name,
    language: row.language,
    category: row.category,
    sub_category: row.sub_category ?? null,
    parameter_format: row.parameter_format ?? null,
    components: row.components,
    status: row.status,
    quality_score: row.quality_score ?? null,
    rejected_reason: row.rejected_reason ?? null,
    message_send_ttl_seconds: row.message_send_ttl_seconds ?? null,
    origin: row.origin,
    sync_state: row.sync_state,
    is_active: row.is_active,
    last_synced_at: row.last_synced_at ?? null,
    last_error: row.last_error ?? null,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
  });

  private buildFilters(input: {
    accountId: string;
    workerId: string;
    query?: ListWhatsappTemplatesQuery;
  }): SQLWrapper[] {
    const filters: SQLWrapper[] = [
      eq(whatsappMessageTemplate.account_id, input.accountId),
      eq(whatsappMessageTemplate.worker_id, input.workerId),
      isNull(whatsappMessageTemplate.deleted_at),
    ];

    const query = input.query;

    if (!query) {
      return filters;
    }

    if (query.search) {
      const search = `%${query.search}%`;
      const combined = or(
        ilike(whatsappMessageTemplate.name, search),
        ilike(whatsappMessageTemplate.language, search),
        ilike(whatsappMessageTemplate.category, search)
      );
      if (combined) filters.push(combined);
    }

    if (query.status) {
      filters.push(eq(whatsappMessageTemplate.status, query.status));
    }

    if (query.category) {
      filters.push(eq(whatsappMessageTemplate.category, query.category));
    }

    if (query.language) {
      filters.push(eq(whatsappMessageTemplate.language, query.language));
    }

    if (typeof query.is_active === 'boolean') {
      filters.push(eq(whatsappMessageTemplate.is_active, query.is_active));
    }

    return filters;
  }

  list = async (input: {
    accountId: string;
    workerId: string;
    query: ListWhatsappTemplatesQuery;
  }): Promise<[WhatsappTemplateResponse[], number]> => {
    const filters = this.buildFilters(input);
    const perPage = input.query.per_page ?? 10;
    const currentPage = input.query.current_page ?? 1;

    const [rows, totals] = await Promise.all([
      this.dbRo.query.whatsappMessageTemplate.findMany({
        where: and(...filters),
        orderBy: [
          asc(whatsappMessageTemplate.name),
          asc(whatsappMessageTemplate.language),
        ],
        limit: perPage,
        offset: (currentPage - 1) * perPage,
      }),
      this.dbRo
        .select({ value: count() })
        .from(whatsappMessageTemplate)
        .where(and(...filters))
        .execute(),
    ]);

    return [rows.map(this.mapTemplate), totals[0]?.value ?? 0];
  };

  listAllByWorker = async (input: {
    accountId: string;
    workerId: string;
  }): Promise<WhatsappTemplateResponse[]> => {
    const rows = await this.dbRo.query.whatsappMessageTemplate.findMany({
      where: and(...this.buildFilters(input)),
      orderBy: [
        asc(whatsappMessageTemplate.name),
        asc(whatsappMessageTemplate.language),
      ],
    });

    return rows.map(this.mapTemplate);
  };

  view = async (input: {
    accountId: string;
    workerId: string;
    templateId: string;
  }): Promise<WhatsappTemplateResponse | null> => {
    const row = await this.dbRo.query.whatsappMessageTemplate.findFirst({
      where: and(
        eq(
          whatsappMessageTemplate.whatsapp_message_template_id,
          input.templateId
        ),
        eq(whatsappMessageTemplate.account_id, input.accountId),
        eq(whatsappMessageTemplate.worker_id, input.workerId),
        isNull(whatsappMessageTemplate.deleted_at)
      ),
    });

    return row ? this.mapTemplate(row) : null;
  };

  findByRemoteKey = async (input: {
    accountId: string;
    workerId: string;
    metaTemplateId: string | null;
    name: string;
    language: string;
  }): Promise<WhatsappTemplateResponse | null> => {
    const remoteIdFilter = input.metaTemplateId
      ? eq(whatsappMessageTemplate.meta_template_id, input.metaTemplateId)
      : undefined;

    const nameLanguageFilter = and(
      eq(whatsappMessageTemplate.name, input.name),
      eq(whatsappMessageTemplate.language, input.language)
    );

    const row = await this.dbRo.query.whatsappMessageTemplate.findFirst({
      where: and(
        eq(whatsappMessageTemplate.account_id, input.accountId),
        eq(whatsappMessageTemplate.worker_id, input.workerId),
        isNull(whatsappMessageTemplate.deleted_at),
        remoteIdFilter
          ? or(remoteIdFilter, nameLanguageFilter)
          : nameLanguageFilter
      ),
    });

    return row ? this.mapTemplate(row) : null;
  };

  create = async (
    input: WhatsappTemplateUpsertInput
  ): Promise<WhatsappTemplateResponse> => {
    const [row] = await this.dbRw
      .insert(whatsappMessageTemplate)
      .values({
        ...input,
        last_synced_at: input.last_synced_at ?? null,
        last_error: input.last_error ?? null,
      })
      .returning()
      .execute();

    return this.mapTemplate(row);
  };

  update = async (input: {
    accountId: string;
    workerId: string;
    templateId: string;
    data: WhatsappTemplateUpdateInput;
  }): Promise<WhatsappTemplateResponse | null> => {
    const now = currentTime();
    const [row] = await this.dbRw
      .update(whatsappMessageTemplate)
      .set({
        ...input.data,
        sub_category:
          input.data.sub_category === undefined
            ? undefined
            : input.data.sub_category,
        parameter_format:
          input.data.parameter_format === undefined
            ? undefined
            : input.data.parameter_format,
        message_send_ttl_seconds:
          input.data.message_send_ttl_seconds === undefined
            ? undefined
            : input.data.message_send_ttl_seconds,
        updated_at: now,
      })
      .where(
        and(
          eq(
            whatsappMessageTemplate.whatsapp_message_template_id,
            input.templateId
          ),
          eq(whatsappMessageTemplate.account_id, input.accountId),
          eq(whatsappMessageTemplate.worker_id, input.workerId),
          isNull(whatsappMessageTemplate.deleted_at)
        )
      )
      .returning()
      .execute();

    return row ? this.mapTemplate(row) : null;
  };

  upsertFromMeta = async (
    input: WhatsappTemplateUpsertInput
  ): Promise<WhatsappTemplateResponse> => {
    const existing = await this.findByRemoteKey({
      accountId: input.account_id,
      workerId: input.worker_id,
      metaTemplateId: input.meta_template_id,
      name: input.name,
      language: input.language,
    });

    if (!existing) {
      return this.create(input);
    }

    const updated = await this.update({
      accountId: input.account_id,
      workerId: input.worker_id,
      templateId: existing.whatsapp_message_template_id,
      data: {
        meta_template_id: input.meta_template_id,
        name: input.name,
        language: input.language,
        category: input.category,
        sub_category: input.sub_category,
        parameter_format: input.parameter_format,
        components: input.components,
        status: input.status,
        quality_score: input.quality_score,
        rejected_reason: input.rejected_reason,
        message_send_ttl_seconds: input.message_send_ttl_seconds,
        meta_payload: input.meta_payload,
        origin: existing.origin === 'underchat' ? 'underchat' : 'meta',
        sync_state: input.sync_state,
        is_active: input.is_active,
        last_synced_at: input.last_synced_at ?? currentTime(),
        last_error: null,
      },
    });

    if (!updated) {
      throw new Error('Failed to update WhatsApp template');
    }

    return updated;
  };

  markError = async (input: {
    accountId: string;
    workerId: string;
    templateId: string;
    error: string;
  }): Promise<WhatsappTemplateResponse | null> =>
    this.update({
      accountId: input.accountId,
      workerId: input.workerId,
      templateId: input.templateId,
      data: {
        sync_state: 'sync_error',
        status: 'SYNC_ERROR',
        last_error: input.error,
      },
    });
}
