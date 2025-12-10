export interface IElasticsearchNestedQuery {
  nested: {
    path: string;
    query: {
      term: Record<string, string>;
    };
  };
}

export interface IElasticsearchTermQuery {
  term: Record<string, string>;
}

export type IElasticsearchBoolClause =
  | IElasticsearchNestedQuery
  | IElasticsearchTermQuery;
