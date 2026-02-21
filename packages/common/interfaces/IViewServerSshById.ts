export interface IViewServerSshById {
  server_status_id: string;
  ssh_ip: string;
  ssh_port: number;
  ssh_username: string;
  ssh_password: string;
  proxy_enabled: boolean;
  proxy_host: string | null;
  proxy_port: number | null;
  proxy_username: string | null;
  proxy_password: string | null;
}
