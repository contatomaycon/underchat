export interface ICreateMessageTemplate {
  account_id: string;
  message: string;
  command: string;
  attachment_url?: string | null;
  message_status_id: string;
  type: string;
  mimetype?: string | null;
  duration?: number | null;
  width?: number | null;
  height?: number | null;
  auto_send?: boolean;
}
