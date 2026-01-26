import { Client } from '@elastic/elasticsearch';
import { inject, injectable } from 'tsyringe';
import type {
  AggregationsAggregate,
  QueryDslQueryContainer,
  SearchResponse,
} from '@elastic/elasticsearch/lib/api/types';
import type {
  IElasticBulkCreateItem,
  IElasticBulkResponse,
  IElasticBulkUpdateItem,
} from '@core/common/interfaces/IElasticBulk';
import { metricsCount } from '@core/plugins/telemetry/sentry';

@injectable()
export class ElasticDatabaseService {
  constructor(
    @inject('DatabaseElasticClient') private readonly client: Client
  ) {}

  public async select<
    TDoc = unknown,
    TAggs extends Record<string, AggregationsAggregate> = Record<
      string,
      AggregationsAggregate
    >,
  >(index: string, query: object): Promise<SearchResponse<TDoc, TAggs> | null> {
    try {
      const response = await this.client.search<TDoc, TAggs>({
        index,
        body: query,
      });

      return response;
    } catch {
      return null;
    }
  }

  create = async (
    index: string,
    document: object,
    id: string
  ): Promise<boolean> => {
    try {
      const result = await this.client.index({
        index,
        id,
        document,
        op_type: 'create',
      });

      return result.result === 'created';
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'statusCode' in error &&
        error.statusCode === 409
      ) {
        return false;
      }

      throw new Error(`Failed to create document with ID: ${error}`);
    }
  };

  createDocument = async <T extends object>(
    index: string,
    id: string,
    document: T
  ): Promise<'created' | 'conflict'> => {
    try {
      const result = await this.client.index({
        index,
        id,
        document,
        op_type: 'create',
      });

      if (result.result === 'created') {
        return 'created';
      }

      return 'conflict';
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'statusCode' in error &&
        error.statusCode === 409
      ) {
        return 'conflict';
      }

      throw new Error(`Failed to create document with ID: ${error}`);
    }
  };

  view = async (index: string, id: string): Promise<object | null> => {
    try {
      const result = await this.client.get({
        index,
        id,
      });
      return result._source ?? null;
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'statusCode' in error &&
        error.statusCode === 404
      ) {
        return null;
      }

      throw new Error(`Failed to retrieve document with ID: ${error}`);
    }
  };

  getDocumentMeta = async (
    index: string,
    id: string
  ): Promise<{ seqNo: number; primaryTerm: number } | null> => {
    try {
      const result = await this.client.get({
        index,
        id,
      });

      if (
        typeof result._seq_no === 'number' &&
        typeof result._primary_term === 'number'
      ) {
        return {
          seqNo: result._seq_no,
          primaryTerm: result._primary_term,
        };
      }

      return null;
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'statusCode' in error &&
        error.statusCode === 404
      ) {
        return null;
      }

      throw new Error(`Failed to get document meta with ID: ${error}`);
    }
  };

  private async getBulkDocumentMeta(
    index: string,
    ids: string[]
  ): Promise<Map<string, { seqNo: number; primaryTerm: number }>> {
    if (ids.length === 0) {
      return new Map();
    }

    try {
      const docs = ids.map((id) => ({ _index: index, _id: id }));
      const result = await this.client.mget({ docs });

      const metaMap = new Map<string, { seqNo: number; primaryTerm: number }>();

      for (const doc of result.docs) {
        if ('error' in doc) {
          continue;
        }

        if (
          doc.found &&
          typeof doc._seq_no === 'number' &&
          typeof doc._primary_term === 'number'
        ) {
          metaMap.set(doc._id, {
            seqNo: doc._seq_no,
            primaryTerm: doc._primary_term,
          });
        }
      }

      return metaMap;
    } catch (error) {
      throw new Error(`Failed to get bulk document meta: ${error}`);
    }
  }

  update = async (
    index: string,
    document: Record<string, unknown>,
    id: string,
    retryOnConflict?: number
  ): Promise<boolean> => {
    const maxRetries = retryOnConflict ?? 5;
    let attempt = 0;

    while (attempt < maxRetries) {
      try {
        const meta = await this.getDocumentMeta(index, id);

        if (!meta) {
          const createResult = await this.tryCreateDocument(
            index,
            id,
            document
          );

          if (createResult === 'created') {
            return true;
          }

          attempt++;
          continue;
        }

        const updateResult = await this.tryUpdateWithMeta(
          index,
          id,
          document,
          meta,
          document
        );

        if (updateResult === 'conflict') {
          attempt++;
          continue;
        }

        return (
          updateResult === 'updated' ||
          updateResult === 'created' ||
          updateResult === 'noop'
        );
      } catch (error) {
        if (attempt >= maxRetries - 1) {
          throw new Error(`Failed to update document with ID: ${error}`);
        }

        attempt++;
      }
    }

    return false;
  };

  private async tryCreateDocument<T extends Record<string, unknown>>(
    index: string,
    id: string,
    doc: T
  ): Promise<'created' | 'conflict'> {
    try {
      const createResult = await this.client.index({
        index,
        id,
        document: doc,
        op_type: 'create',
      });

      if (createResult.result === 'created') {
        return 'created';
      }

      return 'conflict';
    } catch (createError: unknown) {
      if (
        typeof createError === 'object' &&
        createError !== null &&
        'statusCode' in createError &&
        createError.statusCode === 409
      ) {
        return 'conflict';
      }

      throw createError;
    }
  }

  private async tryUpdateWithMeta<T extends Record<string, unknown>>(
    index: string,
    id: string,
    doc: T,
    meta: { seqNo: number; primaryTerm: number },
    upsert?: T
  ): Promise<'updated' | 'created' | 'noop' | 'conflict'> {
    try {
      const updateParams: {
        index: string;
        id: string;
        doc: T;
        if_seq_no: number;
        if_primary_term: number;
        upsert?: T;
      } = {
        index,
        id,
        doc,
        if_seq_no: meta.seqNo,
        if_primary_term: meta.primaryTerm,
      };

      if (upsert) {
        updateParams.upsert = upsert;
      }

      const result = await this.client.update(updateParams);

      if (result.result === 'updated') {
        return 'updated';
      }

      if (result.result === 'created') {
        return 'created';
      }

      return 'noop';
    } catch (updateError: unknown) {
      if (
        typeof updateError === 'object' &&
        updateError !== null &&
        'statusCode' in updateError &&
        updateError.statusCode === 409
      ) {
        return 'conflict';
      }

      throw updateError;
    }
  }

  updateWithOCC = async <T extends Record<string, unknown>>(
    index: string,
    id: string,
    doc: T,
    options?: { upsert?: boolean; maxRetries?: number }
  ): Promise<'updated' | 'created' | 'noop' | 'conflict' | 'not_found'> => {
    const maxRetries = options?.maxRetries ?? 5;
    let attempt = 0;

    while (attempt < maxRetries) {
      try {
        const meta = await this.getDocumentMeta(index, id);

        if (!meta) {
          if (options?.upsert !== true) {
            return 'not_found';
          }

          const createResult = await this.tryCreateDocument(index, id, doc);

          if (createResult === 'created') {
            return 'created';
          }

          attempt++;
          continue;
        }

        const updateResult = await this.tryUpdateWithMeta(index, id, doc, meta);

        if (updateResult !== 'conflict') {
          return updateResult;
        }

        attempt++;
      } catch (error) {
        if (attempt >= maxRetries - 1) {
          throw new Error(`Failed to update with OCC after retries: ${error}`);
        }

        attempt++;
      }
    }

    return 'conflict';
  };

  updateArrayField = async (
    index: string,
    id: string,
    field: string,
    value: string,
    retryOnConflict?: number
  ): Promise<boolean> => {
    const maxRetries = retryOnConflict ?? 5;
    let attempt = 0;

    while (attempt < maxRetries) {
      const meta = await this.getDocumentMeta(index, id);

      if (!meta) {
        return false;
      }

      try {
        const result = await this.client.update({
          index,
          id,
          if_seq_no: meta.seqNo,
          if_primary_term: meta.primaryTerm,
          script: {
            source: `
              if (ctx._source.${field} == null) {
                ctx._source.${field} = [params.value];
              } else if (!ctx._source.${field}.contains(params.value)) {
                ctx._source.${field}.add(params.value);
              }
            `,
            params: {
              value,
            },
          },
        });

        if (
          result.result === 'updated' ||
          result.result === 'created' ||
          result.result === 'noop'
        ) {
          return true;
        }
      } catch (error: unknown) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'statusCode' in error &&
          error.statusCode === 409
        ) {
          attempt++;
          continue;
        }

        throw new Error(`Failed to update array field: ${error}`);
      }
    }

    return false;
  };

  updateField = async (
    index: string,
    id: string,
    field: string,
    value: any,
    retryOnConflict?: number
  ): Promise<boolean> => {
    const maxRetries = retryOnConflict ?? 5;
    let attempt = 0;

    while (attempt < maxRetries) {
      const meta = await this.getDocumentMeta(index, id);

      if (!meta) {
        return false;
      }

      try {
        const result = await this.client.update({
          index,
          id,
          if_seq_no: meta.seqNo,
          if_primary_term: meta.primaryTerm,
          script: {
            source: `ctx._source.${field} = params.value`,
            params: {
              value,
            },
          },
        });

        if (
          result.result === 'updated' ||
          result.result === 'created' ||
          result.result === 'noop'
        ) {
          return true;
        }
      } catch (error: unknown) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'statusCode' in error &&
          error.statusCode === 409
        ) {
          attempt++;
          continue;
        }

        throw new Error(`Failed to update field: ${error}`);
      }
    }

    return false;
  };

  updateWithScript = async <TParams extends Record<string, unknown>>(
    index: string,
    id: string,
    input: {
      source: string;
      params: TParams;
      upsert?: Record<string, unknown>;
      scriptedUpsert?: boolean;
    },
    options?: { retryOnConflict?: number; refresh?: boolean }
  ): Promise<'updated' | 'created' | 'noop'> => {
    const maxRetries = options?.retryOnConflict ?? 5;
    let attempt = 0;

    while (attempt < maxRetries) {
      const meta = await this.getDocumentMeta(index, id);

      if (!meta) {
        if (!input.upsert) {
          throw new Error(`Failed to update with script: document not found`);
        }

        try {
          const createResult = await this.tryCreateWithScript(
            index,
            id,
            input,
            options?.refresh
          );

          if (createResult !== 'conflict') {
            return createResult;
          }

          attempt++;
          continue;
        } catch (error: unknown) {
          if (
            typeof error === 'object' &&
            error !== null &&
            'statusCode' in error &&
            error.statusCode === 409
          ) {
            attempt++;
            continue;
          }

          if (attempt >= maxRetries - 1) {
            throw new Error(`Failed to update with script: ${error}`);
          }

          attempt++;
          continue;
        }
      }

      try {
        const updateResult = await this.tryUpdateWithScriptAndMeta(
          index,
          id,
          input,
          meta,
          options?.refresh
        );

        if (updateResult !== 'conflict') {
          return updateResult;
        }

        attempt++;
      } catch (error: unknown) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'statusCode' in error &&
          error.statusCode === 409
        ) {
          attempt++;
          continue;
        }

        if (attempt >= maxRetries - 1) {
          throw new Error(`Failed to update with script: ${error}`);
        }

        attempt++;
      }
    }

    throw new Error(
      `Failed to update with script after ${maxRetries} attempts: conflict`
    );
  };

  private async tryUpdateWithScriptAndMeta<
    TParams extends Record<string, unknown>,
  >(
    index: string,
    id: string,
    input: {
      source: string;
      params: TParams;
      upsert?: Record<string, unknown>;
      scriptedUpsert?: boolean;
    },
    meta: { seqNo: number; primaryTerm: number },
    refresh?: boolean
  ): Promise<'updated' | 'created' | 'noop' | 'conflict'> {
    try {
      const updateParams: {
        index: string;
        id: string;
        script: {
          source: string;
          params: TParams;
        };
        if_seq_no?: number;
        if_primary_term?: number;
        upsert?: Record<string, unknown>;
        scripted_upsert?: boolean;
        refresh?: boolean | 'wait_for';
      } = {
        index,
        id,
        script: {
          source: input.source,
          params: input.params,
        },
      };

      if (input.upsert) {
        updateParams.upsert = input.upsert;
        updateParams.scripted_upsert = input.scriptedUpsert ?? true;
      } else {
        updateParams.if_seq_no = meta.seqNo;
        updateParams.if_primary_term = meta.primaryTerm;
      }

      if (refresh) {
        updateParams.refresh = true;
      }

      const result = await this.client.update(updateParams);

      if (result.result === 'updated') {
        return 'updated';
      }

      if (result.result === 'created') {
        return 'created';
      }

      return 'noop';
    } catch (updateError: unknown) {
      if (
        typeof updateError === 'object' &&
        updateError !== null &&
        'statusCode' in updateError &&
        updateError.statusCode === 409
      ) {
        return 'conflict';
      }

      throw updateError;
    }
  }

  private async tryCreateWithScript<TParams extends Record<string, unknown>>(
    index: string,
    id: string,
    input: {
      source: string;
      params: TParams;
      upsert?: Record<string, unknown>;
      scriptedUpsert?: boolean;
    },
    refresh?: boolean
  ): Promise<'created' | 'updated' | 'noop' | 'conflict'> {
    try {
      const updateParams: {
        index: string;
        id: string;
        script: {
          source: string;
          params: TParams;
        };
        upsert: Record<string, unknown>;
        scripted_upsert: boolean;
        refresh?: boolean | 'wait_for';
      } = {
        index,
        id,
        script: {
          source: input.source,
          params: input.params,
        },
        upsert: input.upsert ?? {},
        scripted_upsert: input.scriptedUpsert ?? true,
      };

      if (refresh) {
        updateParams.refresh = true;
      }

      const result = await this.client.update(updateParams);

      if (result.result === 'created' || result.result === 'updated') {
        return result.result === 'created' ? 'created' : 'updated';
      }

      return 'noop';
    } catch (createError: unknown) {
      if (
        typeof createError === 'object' &&
        createError !== null &&
        'statusCode' in createError &&
        createError.statusCode === 409
      ) {
        return 'conflict';
      }

      throw createError;
    }
  }

  updateWithScriptOCC = async <TParams extends Record<string, unknown>>(
    index: string,
    id: string,
    input: {
      source: string;
      params: TParams;
      upsert?: Record<string, unknown>;
      scriptedUpsert?: boolean;
    },
    options?: { upsert?: boolean; maxRetries?: number; refresh?: boolean }
  ): Promise<'updated' | 'created' | 'noop' | 'conflict' | 'not_found'> => {
    const maxRetries = options?.maxRetries ?? 5;
    let attempt = 0;

    while (attempt < maxRetries) {
      try {
        const meta = await this.getDocumentMeta(index, id);

        if (!meta) {
          if (options?.upsert !== true && !input.upsert) {
            return 'not_found';
          }

          const createResult = await this.tryCreateWithScript(
            index,
            id,
            input,
            options?.refresh
          );

          if (createResult !== 'conflict') {
            return createResult;
          }

          attempt++;
          continue;
        }

        const updateResult = await this.tryUpdateWithScriptAndMeta(
          index,
          id,
          input,
          meta,
          options?.refresh
        );

        if (updateResult !== 'conflict') {
          if (attempt > 0) {
            metricsCount('elastic.update.script.occ.retry', attempt, {
              index,
              result: updateResult,
            });
          }
          return updateResult;
        }

        attempt++;
      } catch (error) {
        if (attempt >= maxRetries - 1) {
          metricsCount('elastic.update.script.occ.max_retries_exceeded', 1, {
            index,
            max_retries: maxRetries,
          });
          throw new Error(
            `Failed to update with script OCC after retries: ${error}`
          );
        }

        attempt++;
      }
    }

    metricsCount('elastic.update.script.occ.conflict_after_retries', 1, {
      index,
      max_retries: maxRetries,
    });

    return 'conflict';
  };

  updateByQueryWithScript = async <TParams extends Record<string, unknown>>(
    index: string,
    query: QueryDslQueryContainer,
    script: { source: string; params: TParams },
    options?: {
      conflicts?: 'abort' | 'proceed';
      refresh?: boolean;
      waitForCompletion?: boolean;
      requestsPerSecond?: number;
      slices?: number | 'auto';
      maxRetries?: number;
      batchSize?: number;
    }
  ): Promise<{
    updated: number;
    total: number;
    versionConflicts: number;
    failures: Array<{ id?: string; cause: string }>;
  }> => {
    const conflictsPolicy = options?.conflicts ?? 'abort';
    const maxRetries = options?.maxRetries ?? 5;
    const batchSize = options?.batchSize ?? 100;

    let total = 0;
    let updated = 0;
    let versionConflicts = 0;
    const failures: Array<{ id?: string; cause: string }> = [];

    try {
      let scrollId: string | undefined;
      let hasMore = true;

      while (hasMore) {
        const searchResponse = scrollId
          ? await this.client.scroll({
              scroll_id: scrollId,
              scroll: '1m',
            })
          : await this.client.search({
              index,
              body: { query } as any,
              scroll: '1m',
              size: batchSize,
              _source: false,
            });

        const hits = searchResponse.hits.hits ?? [];
        total += hits.length;

        if (hits.length === 0) {
          hasMore = false;
          if (scrollId) {
            await this.client.clearScroll({ scroll_id: scrollId });
          }
          break;
        }

        const ids = hits
          .map((hit) => hit._id)
          .filter((id): id is string => !!id);

        if (ids.length === 0) {
          scrollId = (searchResponse as any)._scroll_id;
          hasMore = !!scrollId && hits.length === batchSize;
          continue;
        }

        const updatePromises = ids.map(async (id) => {
          const result = await this.updateWithScriptOCC(
            index,
            id,
            {
              source: script.source,
              params: script.params as Record<string, unknown>,
            },
            { maxRetries }
          );

          if (result === 'updated' || result === 'created') {
            return { id, success: true };
          }

          if (result === 'conflict') {
            return { id, success: false, conflict: true };
          }

          return { id, success: false, conflict: false };
        });

        const results = await Promise.all(updatePromises);

        for (const result of results) {
          if (result.success) {
            updated++;
            continue;
          }

          if (result.conflict) {
            versionConflicts++;
            failures.push({
              id: result.id,
              cause: 'Version conflict',
            });
            continue;
          }

          failures.push({
            id: result.id,
            cause: 'Update failed',
          });
        }

        if (options?.requestsPerSecond && options.requestsPerSecond > 0) {
          const delay = Math.ceil(
            (ids.length / options.requestsPerSecond) * 1000
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }

        scrollId = (searchResponse as any)._scroll_id;
        hasMore = !!scrollId && hits.length === batchSize;
      }

      if (conflictsPolicy === 'abort' && versionConflicts > 0) {
        throw new Error(
          `Update by query failed with ${versionConflicts} version conflicts. Updated: ${updated}, Total: ${total}`
        );
      }

      if (options?.refresh) {
        await this.client.indices.refresh({ index });
      }

      return {
        updated,
        total,
        versionConflicts,
        failures,
      };
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw error;
      }

      throw new Error(`Failed to update by query with script: ${error}`);
    }
  };

  bulkCreateIdempotent = async <T extends object>(
    index: string,
    documents: T[],
    getId: (doc: T) => string | null
  ): Promise<{ created: number; conflicts: number; failed: number }> => {
    const body = documents.flatMap((doc) => {
      const id = getId(doc);
      if (!id) return [];

      return [{ create: { _index: index, _id: id } }, doc];
    });

    if (body.length === 0) {
      return { created: 0, conflicts: 0, failed: 0 };
    }

    try {
      const response = (await this.client.bulk({
        body,
      })) as IElasticBulkResponse;

      let created = 0;
      let conflicts = 0;
      let failed = 0;
      const errorMessages: string[] = [];

      for (const item of response.items) {
        const createItem = item as IElasticBulkCreateItem;
        if (!createItem.create) continue;

        if (createItem.create.error) {
          if (createItem.create.status === 409) {
            conflicts++;
            continue;
          }

          failed++;
          if (errorMessages.length < 5) {
            errorMessages.push(
              `${createItem.create.error.type}: ${createItem.create.error.reason}`
            );
          }
          continue;
        }

        if (createItem.create.result === 'created') {
          created++;
        }
      }

      if (failed > 0) {
        throw new Error(
          `Bulk create failed: ${failed} errors. ${JSON.stringify(errorMessages)}`
        );
      }

      return { created, conflicts, failed };
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }

      throw new Error(`Failed to bulk create documents: ${error}`);
    }
  };

  bulkUpdateWithScript = async <TParams extends Record<string, unknown>>(
    index: string,
    operations: Array<{
      id: string;
      script: { source: string; params: TParams };
      upsert?: Record<string, unknown>;
      retryOnConflict?: number;
    }>
  ): Promise<{ updated: number; noop: number; failed: number }> => {
    if (operations.length === 0) {
      return { updated: 0, noop: 0, failed: 0 };
    }

    const ids = operations.map((op) => op.id);
    const metaMap = await this.getBulkDocumentMeta(index, ids);

    const body = operations.flatMap((op): any => {
      const meta = metaMap.get(op.id);

      const payload: {
        script: { source: string; params: TParams };
        scripted_upsert?: boolean;
        upsert?: Record<string, unknown>;
      } = {
        script: {
          source: op.script.source,
          params: op.script.params,
        },
      };

      if (op.upsert) {
        payload.scripted_upsert = true;
        payload.upsert = op.upsert;
      }

      if (meta) {
        return [
          {
            update: {
              _index: index,
              _id: op.id,
              if_seq_no: meta.seqNo,
              if_primary_term: meta.primaryTerm,
            },
          },
          payload,
        ];
      }

      const createPayload: {
        script: { source: string; params: TParams };
        scripted_upsert: boolean;
        upsert: Record<string, unknown>;
      } = {
        script: {
          source: op.script.source,
          params: op.script.params,
        },
        scripted_upsert: true,
        upsert: op.upsert ?? {},
      };

      return [
        {
          update: {
            _index: index,
            _id: op.id,
          },
        },
        createPayload,
      ];
    }) as any;

    try {
      const response = (await this.client.bulk({
        body: body as any,
      })) as IElasticBulkResponse;

      let updated = 0;
      let noop = 0;
      let failed = 0;
      const errorMessages: string[] = [];

      for (const item of response.items) {
        const updateItem = item as IElasticBulkUpdateItem;
        if (!updateItem.update) continue;

        if (updateItem.update.error) {
          failed++;
          if (errorMessages.length < 5) {
            errorMessages.push(
              `${updateItem.update.error.type}: ${updateItem.update.error.reason}`
            );
          }
          continue;
        }

        if (updateItem.update.result === 'updated') {
          updated++;
          continue;
        }

        if (updateItem.update.result === 'noop') {
          noop++;
          continue;
        }

        if (updateItem.update.result === 'created') {
          updated++;
        }
      }

      if (failed > 0) {
        throw new Error(
          `Bulk update with script failed: ${failed} errors. ${JSON.stringify(errorMessages)}`
        );
      }

      return { updated, noop, failed };
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }

      throw new Error(`Failed to bulk update with script: ${error}`);
    }
  };

  private processBulkUpdateResponse(
    response: IElasticBulkResponse,
    updates: Array<{ id: string; document: object }>
  ): {
    failedUpdates: Array<{ id: string; document: object }>;
    errorMessages: string[];
  } {
    const failedUpdates: Array<{ id: string; document: object }> = [];
    const errorMessages: string[] = [];

    for (let i = 0; i < response.items.length; i++) {
      const item = response.items[i];
      const updateItem = item as IElasticBulkUpdateItem;
      const createItem = item as IElasticBulkCreateItem;

      if (updateItem.update?.error) {
        if (updateItem.update.status === 409) {
          failedUpdates.push(updates[i]);
          continue;
        }

        if (errorMessages.length < 5) {
          errorMessages.push(
            `${updateItem.update.error.type}: ${updateItem.update.error.reason}`
          );
        }
        continue;
      }

      if (createItem.create?.error) {
        if (createItem.create.status === 409) {
          failedUpdates.push(updates[i]);
          continue;
        }

        if (errorMessages.length < 5) {
          errorMessages.push(
            `${createItem.create.error.type}: ${createItem.create.error.reason}`
          );
        }
      }
    }

    return { failedUpdates, errorMessages };
  }

  bulkUpdateFields = async (
    index: string,
    updates: Array<{ id: string; document: object }>,
    options?: { maxRetries?: number }
  ): Promise<boolean> => {
    if (updates.length === 0) {
      return true;
    }

    const maxRetries = options?.maxRetries ?? 5;
    let remainingUpdates = [...updates];
    let attempt = 0;

    while (remainingUpdates.length > 0 && attempt < maxRetries) {
      const ids = remainingUpdates.map((update) => update.id);
      const metaMap = await this.getBulkDocumentMeta(index, ids);

      const body = remainingUpdates.flatMap((update) => {
        const meta = metaMap.get(update.id);

        if (meta) {
          return [
            {
              update: {
                _index: index,
                _id: update.id,
                if_seq_no: meta.seqNo,
                if_primary_term: meta.primaryTerm,
              },
            },
            { doc: update.document },
          ];
        }

        return [{ create: { _index: index, _id: update.id } }, update.document];
      });

      try {
        const response = (await this.client.bulk({
          body,
        })) as IElasticBulkResponse;

        if (!response.errors) {
          return true;
        }

        const { failedUpdates, errorMessages } = this.processBulkUpdateResponse(
          response,
          remainingUpdates
        );

        if (errorMessages.length > 0) {
          throw new Error(
            `Bulk update fields failed: ${JSON.stringify(errorMessages)}`
          );
        }

        if (failedUpdates.length === 0) {
          return true;
        }

        remainingUpdates = failedUpdates;
        attempt++;
      } catch (error) {
        if (attempt >= maxRetries - 1) {
          throw new Error(`Failed to bulk update fields: ${error}`);
        }

        attempt++;
      }
    }

    if (remainingUpdates.length > 0) {
      throw new Error(
        `Bulk update fields failed: ${remainingUpdates.length} documents could not be updated after ${maxRetries} retries`
      );
    }

    return true;
  };

  deleteIndex = async (index: string): Promise<boolean> => {
    try {
      const result = await this.client.indices.delete({ index });

      return result.acknowledged;
    } catch (error) {
      throw new Error(`Failed to delete index: ${error}`);
    }
  };

  deleteAllByQuery = async (
    index: string,
    query: QueryDslQueryContainer
  ): Promise<boolean> => {
    try {
      const { deleted = 0 } = await this.client.deleteByQuery({
        index,
        query,
      });

      return deleted > 0;
    } catch {
      return false;
    }
  };

  delete = async (index: string, id: string): Promise<boolean> => {
    try {
      const result = await this.client.delete({
        index,
        id,
      });

      return result.result === 'deleted';
    } catch (error) {
      throw new Error(`Failed to delete document with ID: ${error}`);
    }
  };

  indices = async (index: string, mappings: object): Promise<boolean> => {
    const exists = await this.client.indices.exists({ index });

    if (!exists) {
      try {
        const result = await this.client.indices.create(
          {
            index,
            body: mappings,
          },
          { ignore: [400] }
        );

        return result.acknowledged;
      } catch (error) {
        throw new Error(`Failed to create index: ${error}`);
      }
    }

    return true;
  };
}
