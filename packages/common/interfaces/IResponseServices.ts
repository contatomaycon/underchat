export interface IResponseService<T = unknown> {
  status?: boolean;
  message?: string;
  httpStatusCode?: number;
  data?: T;
}
