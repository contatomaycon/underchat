export interface IUpdateMessageTemplate {
  message_template_id: string;
  channel_id?: string | null;
  message?: string | null;
  command?: string | null;
  attachment_url?: string | null;
  message_status_id?: string | null;
  type?: string | null;
  mimetype?: string | null;
  duration?: number | null;
  width?: number | null;
  height?: number | null;
  auto_send?: boolean | null;
}
