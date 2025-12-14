export interface IBalanceMonitorServer {
  server_id: string;
  server_status_id: string;
  ssh_ip: string;
  ssh_port: number;
  ssh_username: string;
  ssh_password: string;
  web_domain: string | null;
  web_port: number | null;
  web_protocol: string | null;
}
