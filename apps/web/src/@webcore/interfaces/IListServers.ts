export interface IListServers {
  page: number;
  per_page: number;
  sort_by: string | null;
  sort_order: 'asc' | 'desc' | null;
}
