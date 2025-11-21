export interface IConfigRedis {
  host: string;
  port: number;
  password?: string;
  connectTimeout: number;
  lazyConnect: boolean;
  keepAlive: number;
}
