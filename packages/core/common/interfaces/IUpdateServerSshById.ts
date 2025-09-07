export interface IUpdateServerSshById {
  server_id: string;
  ssh_ip: string;
  ssh_port: number;
  ssh_username?: string | null;
  ssh_password?: string | null;
}
