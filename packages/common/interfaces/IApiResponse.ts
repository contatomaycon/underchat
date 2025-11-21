export interface IApiResponse<T> {
  status: boolean;
  message: string;
  data: T;
  id: string;
}
