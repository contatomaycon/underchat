export interface ITopicInfo {
  name: string;
  partitions: Array<{
    leader: number;
  }>;
}
