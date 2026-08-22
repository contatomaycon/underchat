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
  private static readonly OCC_RETRY_BASE_DELAY_MS = 50;
  private static readonly OCC_RETRY_MAX_DELAY_MS = 1_000;

  constructor(
    @inject('DatabaseElasticClient') private readonly client: Client
  ) {}

  private normalizeErrorMessage(error: unknown): string {
    const messages: string[] = [];

    for (const item of this.getErrorChain(error)) {
      const record = this.asRecord(item);

      if (item instanceof Error) {
        messages.push(item.name, item.message);
      } else if (typeof record?.message === 'string') {
        messages.push(record.message);
      }

      const body = this.asRecord(record?.body);
      const meta = this.asRecord(record?.meta);
      const metaBody = this.asRecord(meta?.body);

      for (const errorBody of [body?.error, metaBody?.error]) {
        if (typeof errorBody === 'string') {
          messages.push(errorBody);
          continue;
        }

        const errorRecord = this.asRecord(errorBody);
        if (typeof errorRecord?.type === 'string') {
          messages.push(errorRecord.type);
        }
        if (typeof errorRecord?.reason === 'string') {
          messages.push(errorRecord.reason);
        }
      }
    }

    if (messages.length === 0) {
      messages.push(String(error));
    }

    return messages.join(' ').toLowerCase();
  }

  private getErrorChain(error: unknown): unknown[] {
    const chain: unknown[] = [];
    const visited = new Set<unknown>();
    let current: unknown = error;

    while (current !== undefined && current !== null && !visited.has(current)) {
      chain.push(current);
      visited.add(current);

      const record = this.asRecord(current);
      current = record?.cause;
    }

    return chain;
  }

  private getErrorStatusCode(error: unknown): number | null {
    for (const item of this.getErrorChain(error)) {
      const record = this.asRecord(item);
      const meta = this.asRecord(record?.meta);
      const body = this.asRecord(record?.body);
      const metaBody = this.asRecord(meta?.body);
      const values = [
        record?.statusCode,
        record?.status,
        meta?.statusCode,
        body?.status,
        metaBody?.status,
      ];

      for (const value of values) {
        if (typeof value === 'number' && Number.isInteger(value)) {
          return value;
        }
      }
    }

    return null;
  }

  private getElasticErrorType(error: unknown): string | null {
    for (const item of this.getErrorChain(error)) {
      const record = this.asRecord(item);
      const meta = this.asRecord(record?.meta);
      const body = this.asRecord(record?.body);
      const metaBody = this.asRecord(meta?.body);

      for (const errorBody of [body?.error, metaBody?.error]) {
        const errorRecord = this.asRecord(errorBody);
        if (typeof errorRecord?.type === 'string') {
          return errorRecord.type;
        }
      }

      if (typeof record?.type === 'string') {
        return record.type;
      }

      if (typeof record?.name === 'string' && record.name !== 'Error') {
        return record.name;
      }
    }

    return null;
  }

  private getErrorCode(error: unknown): string | null {
    for (const item of this.getErrorChain(error)) {
      const record = this.asRecord(item);
      if (typeof record?.code === 'string') {
        return record.code;
      }
    }

    return null;
  }

  private isRetryableElasticError(error: unknown): boolean {
    const statusCode = this.getErrorStatusCode(error);
    if ([429, 502, 503, 504].includes(statusCode ?? -1)) {
      return true;
    }

    if (statusCode !== null) {
      return false;
    }

    const code = this.getErrorCode(error)?.toLowerCase() ?? '';
    const message = this.normalizeErrorMessage(error);
    const transientTokens = [
      'econnrefused',
      'econnreset',
      'ehostunreach',
      'enetunreach',
      'etimedout',
      'eai_again',
      'und_err_connect_timeout',
      'connection error',
      'connection refused',
      'connection reset',
      'socket hang up',
      'timeout',
      'timed out',
    ];

    return transientTokens.some(
      (token) => code.includes(token) || message.includes(token)
    );
  }

  private sanitizeErrorContext(value: string): string {
    return value.replace(/[^a-zA-Z0-9._:@/-]/g, '_').slice(0, 160);
  }

  private buildSafeElasticError(
    operation: string,
    index: string,
    id: string | null,
    error: unknown,
    attempts?: number,
    preserveCause = false
  ): Error {
    const statusCode = this.getErrorStatusCode(error);
    const errorType = this.getElasticErrorType(error);
    const context = [
      `operation=${this.sanitizeErrorContext(operation)}`,
      `index=${this.sanitizeErrorContext(index)}`,
      id ? `document_id=${this.sanitizeErrorContext(id)}` : null,
      attempts === undefined ? null : `attempts=${attempts}`,
      statusCode === null ? null : `status=${statusCode}`,
      errorType ? `type=${this.sanitizeErrorContext(errorType)}` : null,
    ]
      .filter((value): value is string => value !== null)
      .join(' ');
    const safeError = new Error(`Elasticsearch operation failed [${context}]`);

    if (preserveCause) {
      (safeError as Error & { cause?: unknown }).cause = error;
    }

    return safeError;
  }

  private async waitForOccRetry(attempt: number): Promise<void> {
    const exponentialDelay = Math.min(
      ElasticDatabaseService.OCC_RETRY_MAX_DELAY_MS,
      ElasticDatabaseService.OCC_RETRY_BASE_DELAY_MS * 2 ** attempt
    );
    const jitter = Math.floor(Math.random() * (exponentialDelay / 2 + 1));

    await new Promise<void>((resolve) => {
      setTimeout(resolve, exponentialDelay + jitter);
    });
  }

  public isReadOnlyAllowDeleteBlockError(error: unknown): boolean {
    const message = this.normalizeErrorMessage(error);
    const hasClusterBlock = message.includes('cluster_block_exception');
    const hasReadOnlyAllowDelete = message.includes('read-only-allow-delete');
    const hasFloodStage =
      message.includes('flood-stage watermark') ||
      message.includes('disk usage exceeded flood-stage watermark');
    const hasTooManyRequests = message.includes('too_many_requests/12');

    return (
      hasClusterBlock &&
      (hasReadOnlyAllowDelete || hasFloodStage || hasTooManyRequests)
    );
  }

  private buildReadOnlyAllowDeleteBlockError(index: string): Error {
    return new Error(
      `Elasticsearch index [${this.sanitizeErrorContext(index)}] is read-only (read_only_allow_delete) due to flood-stage disk watermark. Free disk on Elasticsearch host and clear index.blocks.read_only_allow_delete before retrying writes.`
    );
  }

  public async select<
    TDoc = unknown,
    TAggs extends Record<string, AggregationsAggregate> = Record<
      string,
      AggregationsAggregate
    >,
  >(index: string, query: object): Promise<SearchResponse<TDoc, TAggs> | null> {
    try {
      return await this.selectOrThrow<TDoc, TAggs>(index, query);
    } catch {
      return null;
    }
  }

  public async selectOrThrow<
    TDoc = unknown,
    TAggs extends Record<string, AggregationsAggregate> = Record<
      string,
      AggregationsAggregate
    >,
  >(index: string, query: object): Promise<SearchResponse<TDoc, TAggs>> {
    try {
      return await this.client.search<TDoc, TAggs>({
        index,
        body: query,
      });
    } catch (error) {
      throw this.buildSafeElasticError('search', index, null, error);
    }
  }

  public async refreshIndex(index: string): Promise<void> {
    try {
      await this.client.indices.refresh({ index });
    } catch (error) {
      throw this.buildSafeElasticError('refresh_index', index, null, error);
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

      if (this.isReadOnlyAllowDeleteBlockError(error)) {
        throw this.buildReadOnlyAllowDeleteBlockError(index);
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

      if (this.isReadOnlyAllowDeleteBlockError(error)) {
        throw this.buildReadOnlyAllowDeleteBlockError(index);
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

  getById = async <TDoc = unknown>(
    index: string,
    id: string
  ): Promise<TDoc | null> => {
    try {
      const result = await this.client.get<TDoc>({
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

      throw this.buildSafeElasticError(
        'get_document_meta',
        index,
        id,
        error,
        undefined,
        true
      );
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
      if (this.getErrorStatusCode(createError) === 409) {
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
      // Elasticsearch rejects update requests that combine `upsert` with
      // sequence-number OCC. The caller already observed this document, so an
      // absent/replaced document must conflict and be retried through the
      // create-or-update decision instead of falling back inside this request.
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
      if (this.getErrorStatusCode(updateError) === 409) {
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
        if (this.isReadOnlyAllowDeleteBlockError(error)) {
          throw this.buildReadOnlyAllowDeleteBlockError(index);
        }

        if (this.getErrorStatusCode(error) === 409) {
          attempt++;
          continue;
        }

        if (attempt >= maxRetries - 1 || !this.isRetryableElasticError(error)) {
          throw this.buildSafeElasticError(
            'update_with_occ',
            index,
            id,
            error,
            attempt + 1
          );
        }

        await this.waitForOccRetry(attempt);
        attempt++;
      }
    }

    return 'conflict';
  };

  private async tryIndexWithMeta<T extends Record<string, unknown>>(
    index: string,
    id: string,
    doc: T,
    meta: { seqNo: number; primaryTerm: number }
  ): Promise<'updated' | 'created' | 'conflict'> {
    try {
      const result = await this.client.index({
        index,
        id,
        document: doc,
        if_seq_no: meta.seqNo,
        if_primary_term: meta.primaryTerm,
      });

      if (result.result === 'updated') {
        return 'updated';
      }

      if (result.result === 'created') {
        return 'created';
      }

      return 'updated';
    } catch (indexError: unknown) {
      if (this.getErrorStatusCode(indexError) === 409) {
        return 'conflict';
      }

      throw indexError;
    }
  }

  indexWithOCC = async <T extends Record<string, unknown>>(
    index: string,
    id: string,
    doc: T,
    options?: { upsert?: boolean; maxRetries?: number }
  ): Promise<'updated' | 'created' | 'conflict' | 'not_found'> => {
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

        const indexResult = await this.tryIndexWithMeta(index, id, doc, meta);

        if (indexResult !== 'conflict') {
          return indexResult;
        }

        attempt++;
      } catch (error) {
        if (this.isReadOnlyAllowDeleteBlockError(error)) {
          throw this.buildReadOnlyAllowDeleteBlockError(index);
        }

        if (this.getErrorStatusCode(error) === 409) {
          attempt++;
          continue;
        }

        if (attempt >= maxRetries - 1 || !this.isRetryableElasticError(error)) {
          throw this.buildSafeElasticError(
            'index_with_occ',
            index,
            id,
            error,
            attempt + 1
          );
        }

        await this.waitForOccRetry(attempt);
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
    refresh?: boolean,
    assertActive?: () => void | Promise<void>
  ): Promise<'updated' | 'created' | 'noop' | 'conflict'> {
    try {
      // Keep the existing-document request mutually exclusive with the
      // upsert path in tryCreateWithScript. Besides being required by
      // Elasticsearch, this preserves OCC across competing service pods.
      const updateParams: {
        index: string;
        id: string;
        script: {
          source: string;
          params: TParams;
        };
        if_seq_no: number;
        if_primary_term: number;
        refresh?: boolean | 'wait_for';
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

      if (refresh) {
        updateParams.refresh = true;
      }

      await assertActive?.();
      const result = await this.client.update(updateParams);

      if (result.result === 'updated') {
        return 'updated';
      }

      if (result.result === 'created') {
        return 'created';
      }

      return 'noop';
    } catch (updateError: unknown) {
      if (this.getErrorStatusCode(updateError) === 409) {
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
    refresh?: boolean,
    assertActive?: () => void | Promise<void>
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

      await assertActive?.();
      const result = await this.client.update(updateParams);

      if (result.result === 'created' || result.result === 'updated') {
        return result.result === 'created' ? 'created' : 'updated';
      }

      return 'noop';
    } catch (createError: unknown) {
      if (this.getErrorStatusCode(createError) === 409) {
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
    options?: {
      upsert?: boolean;
      maxRetries?: number;
      refresh?: boolean;
      assertActive?: () => void | Promise<void>;
    }
  ): Promise<'updated' | 'created' | 'noop' | 'conflict' | 'not_found'> => {
    const maxRetries = options?.maxRetries ?? 5;
    let attempt = 0;

    while (attempt < maxRetries) {
      try {
        await options?.assertActive?.();
        const meta = await this.getDocumentMeta(index, id);
        await options?.assertActive?.();

        if (!meta) {
          if (options?.upsert !== true && !input.upsert) {
            return 'not_found';
          }

          const createResult = await this.tryCreateWithScript(
            index,
            id,
            input,
            options?.refresh,
            options?.assertActive
          );
          await options?.assertActive?.();

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
          options?.refresh,
          options?.assertActive
        );
        await options?.assertActive?.();

        if (updateResult !== 'conflict') {
          return updateResult;
        }

        attempt++;
      } catch (error) {
        if (this.isReadOnlyAllowDeleteBlockError(error)) {
          throw this.buildReadOnlyAllowDeleteBlockError(index);
        }

        await options?.assertActive?.();

        if (this.getErrorStatusCode(error) === 409) {
          attempt++;
          continue;
        }

        const retryable = this.isRetryableElasticError(error);
        if (attempt >= maxRetries - 1) {
          throw this.buildSafeElasticError(
            'update_with_script_occ',
            index,
            id,
            error,
            attempt + 1
          );
        }

        if (!retryable) {
          throw this.buildSafeElasticError(
            'update_with_script_occ',
            index,
            id,
            error,
            attempt + 1
          );
        }

        await this.waitForOccRetry(attempt);
        attempt++;
      }
    }

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
          {
            // Bulk update follows the same Elasticsearch invariant as the
            // single-document path: OCC and upsert are mutually exclusive.
            script: {
              source: op.script.source,
              params: op.script.params,
            },
          },
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

  private asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    return value as Record<string, unknown>;
  }

  private getProperties(value: unknown): Record<string, unknown> {
    const record = this.asRecord(value);
    if (!record) {
      return {};
    }

    const properties = this.asRecord(record.properties);
    return properties ?? {};
  }

  private getSubFields(value: unknown): Record<string, unknown> {
    const record = this.asRecord(value);
    if (!record) {
      return {};
    }

    const fields = this.asRecord(record.fields);
    return fields ?? {};
  }

  private getMappingFieldType(value: unknown): string | null {
    const record = this.asRecord(value);
    if (!record) {
      return null;
    }

    if (typeof record.type === 'string') {
      return record.type;
    }

    // Elasticsearch omits `type: "object"` from GET _mapping responses for
    // regular object fields. Presence of `properties` is therefore the
    // canonical way to recognize the implicit object type while reconciling
    // an existing mapping.
    if (this.asRecord(record.properties)) {
      return 'object';
    }

    return null;
  }

  private getCurrentIndexMappings = async (
    index: string
  ): Promise<Record<string, unknown>[]> => {
    try {
      const mappingResponse = await this.client.indices.getMapping({ index });
      const mappings: Record<string, unknown>[] = [];

      for (const indexMapping of Object.values(mappingResponse)) {
        const indexMappingsRecord = this.asRecord(indexMapping);
        const currentMapping = this.asRecord(indexMappingsRecord?.mappings);
        if (currentMapping) {
          mappings.push(currentMapping);
        }
      }

      return mappings;
    } catch (error) {
      throw this.buildSafeElasticError('get_index_mapping', index, null, error);
    }
  };

  private mergeFieldDefinitions(
    currentField: unknown,
    incomingField: unknown
  ): unknown {
    const currentRecord = this.asRecord(currentField);
    const incomingRecord = this.asRecord(incomingField);

    if (!currentRecord || !incomingRecord) {
      return currentField ?? incomingField;
    }

    const mergedField: Record<string, unknown> = {
      ...currentRecord,
    };

    const currentProperties = this.getProperties(currentRecord);
    const incomingProperties = this.getProperties(incomingRecord);
    if (Object.keys(incomingProperties).length > 0) {
      mergedField.properties = this.mergeProperties(
        currentProperties,
        incomingProperties
      );
    }

    const currentSubFields = this.getSubFields(currentRecord);
    const incomingSubFields = this.getSubFields(incomingRecord);
    if (Object.keys(incomingSubFields).length > 0) {
      mergedField.fields = this.mergeProperties(
        currentSubFields,
        incomingSubFields
      );
    }

    return mergedField;
  }

  private mergeProperties(
    currentProperties: Record<string, unknown>,
    incomingProperties: Record<string, unknown>
  ): Record<string, unknown> {
    const mergedProperties: Record<string, unknown> = {
      ...currentProperties,
    };

    for (const [fieldName, incomingField] of Object.entries(
      incomingProperties
    )) {
      const currentField = mergedProperties[fieldName];
      if (!currentField) {
        mergedProperties[fieldName] = incomingField;
        continue;
      }

      mergedProperties[fieldName] = this.mergeFieldDefinitions(
        currentField,
        incomingField
      );
    }

    return mergedProperties;
  }

  private buildMutableMappingPatch(
    desiredMapping: unknown,
    currentMapping: unknown
  ): Record<string, unknown> {
    const desiredRecord = this.asRecord(desiredMapping);
    const currentRecord = this.asRecord(currentMapping);
    if (!desiredRecord || !currentRecord) {
      return {};
    }

    const patch: Record<string, unknown> = {};
    if (
      Object.prototype.hasOwnProperty.call(desiredRecord, 'dynamic') &&
      desiredRecord.dynamic !== currentRecord.dynamic
    ) {
      patch.dynamic = desiredRecord.dynamic;
    }

    const desiredProperties = this.getProperties(desiredRecord);
    const currentProperties = this.getProperties(currentRecord);
    const patchedProperties: Record<string, unknown> = {};

    for (const [fieldName, desiredField] of Object.entries(desiredProperties)) {
      const currentField = currentProperties[fieldName];
      if (!currentField) {
        continue;
      }

      const desiredType = this.getMappingFieldType(desiredField);
      const currentType = this.getMappingFieldType(currentField);

      // Mutable parameters such as `dynamic` can only be applied to the same
      // mapper type. Skipping an incompatible/unknown field prevents a
      // malformed patch from blocking every document write during startup.
      if (desiredType !== currentType && (desiredType || currentType)) {
        continue;
      }

      const fieldPatch = this.buildMutableMappingPatch(
        desiredField,
        currentField
      );
      if (Object.keys(fieldPatch).length === 0) {
        continue;
      }

      if (desiredType) {
        fieldPatch.type = desiredType;
      }

      patchedProperties[fieldName] = fieldPatch;
    }

    if (Object.keys(patchedProperties).length > 0) {
      patch.properties = patchedProperties;
    }

    return patch;
  }

  private mergeMappingPatches(
    currentPatch: Record<string, unknown>,
    incomingPatch: Record<string, unknown>
  ): Record<string, unknown> {
    const mergedPatch: Record<string, unknown> = {
      ...currentPatch,
      ...incomingPatch,
    };
    const currentProperties = this.getProperties(currentPatch);
    const incomingProperties = this.getProperties(incomingPatch);

    if (
      Object.keys(currentProperties).length > 0 ||
      Object.keys(incomingProperties).length > 0
    ) {
      mergedPatch.properties = this.mergeProperties(
        currentProperties,
        incomingProperties
      );
    }

    return mergedPatch;
  }

  private buildAdditiveFieldMapping(
    desiredField: unknown,
    currentField: unknown
  ): Record<string, unknown> | null {
    const desiredFieldRecord = this.asRecord(desiredField);
    const desiredProperties = this.getProperties(desiredField);
    const currentProperties = this.getProperties(currentField);

    const hasDesiredProperties = Object.keys(desiredProperties).length > 0;
    const hasCurrentProperties = Object.keys(currentProperties).length > 0;

    if (hasDesiredProperties && hasCurrentProperties) {
      const nestedProperties = this.buildAdditiveProperties(
        desiredProperties,
        currentProperties,
        desiredFieldRecord?.dynamic === false
      );

      const desiredSubFields = this.getSubFields(desiredField);
      const currentSubFields = this.getSubFields(currentField);
      const nestedSubFields = this.buildAdditiveProperties(
        desiredSubFields,
        currentSubFields
      );

      const patch: Record<string, unknown> = {};

      if (Object.keys(nestedProperties).length > 0) {
        patch.properties = nestedProperties;
      }

      if (Object.keys(nestedSubFields).length > 0) {
        patch.fields = nestedSubFields;
      }

      return Object.keys(patch).length > 0 ? patch : null;
    }

    if (hasDesiredProperties !== hasCurrentProperties) {
      return null;
    }

    const desiredSubFields = this.getSubFields(desiredField);
    const currentSubFields = this.getSubFields(currentField);
    const nestedSubFields = this.buildAdditiveProperties(
      desiredSubFields,
      currentSubFields
    );

    if (Object.keys(nestedSubFields).length > 0) {
      return { fields: nestedSubFields };
    }

    return null;
  }

  private buildAdditiveProperties(
    desiredProperties: Record<string, unknown>,
    currentProperties: Record<string, unknown>,
    skipAbsentSourceOnlyFields = false
  ): Record<string, unknown> {
    const additive: Record<string, unknown> = {};

    for (const [fieldName, desiredField] of Object.entries(desiredProperties)) {
      const currentField = currentProperties[fieldName];

      if (!currentField) {
        const desiredFieldRecord = this.asRecord(desiredField);
        if (
          skipAbsentSourceOnlyFields &&
          desiredFieldRecord?.enabled === false
        ) {
          // With the containing object already set to dynamic:false,
          // Elasticsearch keeps this value in _source without allocating a
          // mapping field. This lets legacy indices at total_fields.limit
          // adopt source-only payloads without a reindex or a limit increase.
          continue;
        }

        additive[fieldName] = desiredField;
        continue;
      }

      const additiveFieldPatch = this.buildAdditiveFieldMapping(
        desiredField,
        currentField
      );

      if (additiveFieldPatch) {
        additive[fieldName] = additiveFieldPatch;
      }
    }

    return additive;
  }

  private isMappingConflictError(error: unknown): boolean {
    const message = String(error);
    const hasTypeChangeConflict = message.includes(
      'cannot be changed from type'
    );
    const hasNestedMergeConflict =
      message.includes("can't merge a non-nested mapping") ||
      message.includes("can't merge a nested mapping");

    return (
      message.includes('illegal_argument_exception') &&
      (hasTypeChangeConflict || hasNestedMergeConflict)
    );
  }

  indices = async (index: string, mappings: object): Promise<boolean> => {
    const exists = await this.client.indices.exists({ index });
    const mappingBody =
      (
        mappings as {
          mappings?: Record<string, unknown>;
        }
      )?.mappings ?? {};
    const desiredProperties = this.getProperties(mappingBody);

    if (!exists) {
      try {
        const result = await this.client.indices.create(
          {
            index,
            body: mappings,
          },
          { ignore: [400] }
        );

        if (!result.acknowledged) {
          return false;
        }
      } catch (error) {
        throw this.buildSafeElasticError('create_index', index, null, error);
      }
    }

    if (exists) {
      const currentMappings = await this.getCurrentIndexMappings(index);
      let mutablePatch: Record<string, unknown> = {};
      let currentProperties: Record<string, unknown> = {};

      for (const currentMapping of currentMappings) {
        mutablePatch = this.mergeMappingPatches(
          mutablePatch,
          this.buildMutableMappingPatch(mappingBody, currentMapping)
        );
        currentProperties = this.mergeProperties(
          currentProperties,
          this.getProperties(currentMapping)
        );
      }

      if (Object.keys(mutablePatch).length > 0) {
        try {
          await this.client.indices.putMapping({
            index,
            ...(mutablePatch as any),
          });
        } catch (error) {
          throw this.buildSafeElasticError(
            'update_mutable_index_mapping',
            index,
            null,
            error
          );
        }
      }

      if (Object.keys(desiredProperties).length === 0) {
        return true;
      }

      const additiveProperties = this.buildAdditiveProperties(
        desiredProperties,
        currentProperties
      );

      if (Object.keys(additiveProperties).length === 0) {
        return true;
      }

      try {
        await this.client.indices.putMapping({
          index,
          properties: additiveProperties as any,
        });
      } catch (error) {
        if (this.isMappingConflictError(error)) {
          return true;
        }

        throw this.buildSafeElasticError(
          'add_index_mapping_fields',
          index,
          null,
          error
        );
      }
    }

    return true;
  };
}
