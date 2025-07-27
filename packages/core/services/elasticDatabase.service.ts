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
    id: string
  ): Promise<boolean> => {
    try {
      const result = await this.client.update({
        index,
        id,
        doc: document,
        doc_as_upsert: true,
      });

      return result.result === 'updated';
    } catch (error) {
      throw new Error(`Failed to update document with ID: ${error}`);
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
        { update: { _index: index, _id: id } },
        { doc, doc_as_upsert: true },
      ];
    });

    if (body.length === 0) {
      return false;
    }

    try {
      const response = await this.client.bulk({ body });

      return !response.errors;
    } catch (error) {
      throw new Error(`Failed to bulk update documents: ${error}`);
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
