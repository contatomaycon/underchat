export interface IElasticBulkCreateItem {
  create?: {
    _index?: string;
    _id?: string;
    status?: number;
    error?: {
      type: string;
      reason: string;
      index?: string;
      shard?: string;
    };
    result?: 'created' | 'conflict';
  };
}

export interface IElasticBulkUpdateItem {
  update?: {
    _index?: string;
    _id?: string;
    status?: number;
    error?: {
      type: string;
      reason: string;
      index?: string;
      shard?: string;
    };
    result?: 'updated' | 'created' | 'noop';
  };
}

export interface IElasticBulkResponse {
  errors: boolean;
  items: Array<IElasticBulkCreateItem | IElasticBulkUpdateItem>;
}
