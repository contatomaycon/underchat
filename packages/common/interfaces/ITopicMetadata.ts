export interface ITopicMetadata {
  topics: Array<{
    name: string;
    partitions?: Array<{
      leader?: number;
    }>;
  }>;
}
