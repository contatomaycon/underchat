import { EProxyProtocol } from '../enums/EProxyProtocol';

export interface IUpdateWorkerConfig {
  show_attendee_name?: boolean;
  show_worker_name?: boolean;
  allow_attendance_only_online?: boolean;
  reject_call?: boolean;
  auto_save_contacts?: boolean;
  proxy_enabled?: boolean;
  proxy_protocol?: EProxyProtocol | null;
  proxy_host?: string | null;
  proxy_port?: number | null;
  proxy_username?: string | null;
  proxy_password?: string | null;
}
