import { Client } from '@elastic/elasticsearch';
import { inject, injectable } from 'tsyringe';
import type {
  AggregationsAggregate,
  QueryDslQueryContainer,
  SearchResponse,
} from '@elastic/elasticsearch/lib/api/types';

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

  update = async (
    index: string,
    document: object,
    id: string,
    retryOnConflict?: number
  ): Promise<boolean> => {
    try {
      const updateParams: any = {
        index,
        id,
        doc: document,
        doc_as_upsert: true,
        retry_on_conflict: retryOnConflict ?? 5,
      };

      const result = await this.client.update(updateParams);

      return (
        result.result === 'updated' ||
        result.result === 'created' ||
        result.result === 'noop'
      );
    } catch (error) {
      throw new Error(`Failed to update document with ID: ${error}`);
    }
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

  bulkUpdate = async <T extends object>(
    index: string,
    documents: T[],
    getId: (doc: T) => string | null
  ): Promise<boolean> => {
    const body = documents.flatMap((doc) => {
      const id = getId(doc);
      if (!id) return [];

      return [
        { update: { _index: index, _id: id, retry_on_conflict: 5 } },
        { doc, doc_as_upsert: true },
      ];
    });

    if (body.length === 0) {
      return false;
    }

    try {
      const response = await this.client.bulk({ body });

      if (response.errors) {
        const errorMessages = response.items
          .filter((item: any) => item.update?.error)
          .map((item: any) => item.update.error)
          .slice(0, 5);

        throw new Error(`Bulk update failed: ${JSON.stringify(errorMessages)}`);
      }

      return true;
    } catch (error) {
      throw new Error(`Failed to bulk update documents: ${error}`);
    }
  };

  bulkUpdateFields = async (
    index: string,
    updates: Array<{ id: string; document: object }>
  ): Promise<boolean> => {
    if (updates.length === 0) {
      return true;
    }

    const body = updates.flatMap((update) => [
      { update: { _index: index, _id: update.id, retry_on_conflict: 5 } },
      { doc: update.document, doc_as_upsert: true },
    ]);

    try {
      const response = await this.client.bulk({ body });

      if (response.errors) {
        const errorMessages = response.items
          .filter((item: any) => item.update?.error)
          .map((item: any) => item.update.error)
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
