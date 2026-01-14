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
      });

      return result.result === 'created';
    } catch (error) {
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
    } catch (error) {
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
          meta
        );

        if (updateResult !== 'conflict') {
          return (
            updateResult === 'updated' ||
            updateResult === 'created' ||
            updateResult === 'noop'
          );
        }

        attempt++;
      } catch (error) {
        if (attempt >= maxRetries - 1) {
          throw new Error(`Failed to update document with ID: ${error}`);
        }

        attempt++;
      }
    }

    throw new Error(
      `Failed to update document with ID after ${maxRetries} retries`
    );
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
    meta: { seqNo: number; primaryTerm: number }
  ): Promise<'updated' | 'created' | 'noop' | 'conflict'> {
    try {
      const updateParams: {
        index: string;
        id: string;
        doc: T;
        if_seq_no: number;
        if_primary_term: number;
      } = {
        index,
        id,
        doc,
        if_seq_no: meta.seqNo,
        if_primary_term: meta.primaryTerm,
      };

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
    value: string
  ): Promise<boolean> => {
    try {
      const result = await this.client.update({
        index,
        id,
        script: {
          source: `
            if (ctx._source.${field} == null) {
              ctx._source.${field} = [params.value];
            } else {
              ctx._source.${field}.add(params.value);
            }
          `,
          params: {
            value,
          },
        },
        upsert: {
          [field]: [value],
        },
        retry_on_conflict: 5,
      });

      return (
        result.result === 'updated' ||
        result.result === 'created' ||
        result.result === 'noop'
      );
    } catch (error) {
      throw new Error(`Failed to update array field: ${error}`);
    }
  };

  updateField = async (
    index: string,
    id: string,
    field: string,
    value: any,
    retryOnConflict?: number
  ): Promise<boolean> => {
    try {
      const updateParams: any = {
        index,
        id,
        script: {
          source: `ctx._source.${field} = params.value`,
          params: {
            value,
          },
        },
        retry_on_conflict: retryOnConflict ?? 5,
      };

      const result = await this.client.update(updateParams);

      return (
        result.result === 'updated' ||
        result.result === 'created' ||
        result.result === 'noop'
      );
    } catch (error) {
      throw new Error(`Failed to update field: ${error}`);
    }
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
    options?: { retryOnConflict?: number }
  ): Promise<'updated' | 'created' | 'noop'> => {
    try {
      const updateParams: {
        index: string;
        id: string;
        script: {
          source: string;
          params: TParams;
        };
        upsert?: Record<string, unknown>;
        scripted_upsert?: boolean;
        retry_on_conflict: number;
      } = {
        index,
        id,
        script: {
          source: input.source,
          params: input.params,
        },
        retry_on_conflict: options?.retryOnConflict ?? 10,
      };

      if (input.upsert) {
        updateParams.upsert = input.upsert;
        updateParams.scripted_upsert = input.scriptedUpsert ?? true;
      }

      const result = await this.client.update(updateParams);

      if (result.result === 'updated') {
        return 'updated';
      }

      if (result.result === 'created') {
        return 'created';
      }

      return 'noop';
    } catch (error) {
      throw new Error(`Failed to update with script: ${error}`);
    }
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
    meta: { seqNo: number; primaryTerm: number }
  ): Promise<'updated' | 'created' | 'noop' | 'conflict'> {
    try {
      const updateParams: {
        index: string;
        id: string;
        script: {
          source: string;
          params: TParams;
        };
        if_seq_no: number;
        if_primary_term: number;
        upsert?: Record<string, unknown>;
        scripted_upsert?: boolean;
      } = {
        index,
        id,
        script: {
          source: input.source,
          params: input.params,
        },
        if_seq_no: meta.seqNo,
        if_primary_term: meta.primaryTerm,
      };

      if (input.upsert) {
        updateParams.upsert = input.upsert;
        updateParams.scripted_upsert = input.scriptedUpsert ?? true;
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
    }
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
    options?: { upsert?: boolean; maxRetries?: number }
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

          const createResult = await this.tryCreateWithScript(index, id, input);

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
          meta
        );

        if (updateResult !== 'conflict') {
          return updateResult;
        }

        attempt++;
      } catch (error) {
        if (attempt >= maxRetries - 1) {
          throw new Error(
            `Failed to update with script OCC after retries: ${error}`
          );
        }

        attempt++;
      }
    }

    return 'conflict';
  };

  updateByQueryWithScript = async <TParams extends object>(
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
    }
  ): Promise<{
    updated: number;
    total: number;
    versionConflicts: number;
    failures: Array<{ id?: string; cause: string }>;
  }> => {
    const conflictsPolicy = options?.conflicts ?? 'abort';
    const refresh = options?.refresh ?? false;
    const waitForCompletion = options?.waitForCompletion ?? true;
    const maxRetries = options?.maxRetries ?? 0;

    const executeUpdateByQuery = async () => {
      const updateParams: {
        index: string;
        query: QueryDslQueryContainer;
        script: { source: string; params: TParams };
        conflicts: 'abort' | 'proceed';
        refresh: boolean;
        wait_for_completion?: boolean;
        requests_per_second?: number;
        slices?: number | 'auto';
      } = {
        index,
        query,
        script: {
          source: script.source,
          params: script.params,
        },
        conflicts: conflictsPolicy,
        refresh,
      };

      if (waitForCompletion !== undefined) {
        updateParams.wait_for_completion = waitForCompletion;
      }

      if (options?.requestsPerSecond !== undefined) {
        updateParams.requests_per_second = options.requestsPerSecond;
      }

      if (options?.slices !== undefined) {
        updateParams.slices = options.slices;
      }

      return this.client.updateByQuery(updateParams);
    };

    try {
      let result = await executeUpdateByQuery();

      const versionConflicts = result.version_conflicts ?? 0;

      if (
        conflictsPolicy === 'proceed' &&
        versionConflicts > 0 &&
        maxRetries > 0
      ) {
        let retryCount = 0;
        let currentResult = result;

        while (
          (currentResult.version_conflicts ?? 0) > 0 &&
          retryCount < maxRetries
        ) {
          retryCount++;
          currentResult = await executeUpdateByQuery();
          result = currentResult;

          if ((currentResult.version_conflicts ?? 0) === 0) {
            break;
          }
        }
      }

      const finalVersionConflicts = result.version_conflicts ?? 0;

      if (conflictsPolicy === 'abort' && finalVersionConflicts > 0) {
        throw new Error(
          `Update by query failed with ${finalVersionConflicts} version conflicts. Updated: ${result.updated}, Total: ${result.total}`
        );
      }

      const failures: Array<{ id?: string; cause: string }> = [];

      if (result.failures) {
        for (const failure of result.failures) {
          let causeReason = 'Unknown error';

          if (
            typeof failure.cause === 'object' &&
            failure.cause !== null &&
            'reason' in failure.cause
          ) {
            const reason = failure.cause.reason;
            causeReason = typeof reason === 'string' ? reason : 'Unknown error';
          }

          if (
            typeof failure.cause === 'object' &&
            failure.cause !== null &&
            'type' in failure.cause &&
            causeReason === 'Unknown error'
          ) {
            const type = failure.cause.type;
            causeReason = typeof type === 'string' ? type : 'Unknown error';
          }

          failures.push({
            id: failure.id,
            cause: causeReason,
          });
        }
      }

      return {
        updated: result.updated ?? 0,
        total: result.total ?? 0,
        versionConflicts: result.version_conflicts ?? 0,
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

    const body = operations.flatMap((op) => {
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

      return [
        {
          update: {
            _index: index,
            _id: op.id,
          },
        },
        payload,
      ];
    });

    try {
      const response = (await this.client.bulk({
        body,
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

  bulkUpdateFields = async (
    index: string,
    updates: Array<{ id: string; document: object }>
  ): Promise<boolean> => {
    if (updates.length === 0) {
      return true;
    }

    const ids = updates.map((update) => update.id);
    const metaMap = await this.getBulkDocumentMeta(index, ids);

    const body = updates.flatMap((update) => {
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
      const response = await this.client.bulk({ body });

      if (response.errors) {
        const errorMessages = response.items
          .filter((item: any) => (item.update || item.create)?.error)
          .map((item: any) => (item.update || item.create)?.error)
          .slice(0, 5);

        throw new Error(
          `Bulk update fields failed: ${JSON.stringify(errorMessages)}`
        );
      }

      return true;
    } catch (error) {
      throw new Error(`Failed to bulk update fields: ${error}`);
    }
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
