export interface IUpdateMessageTemplate {
  message_template_id: string;
  message?: string | null;
  command?: string | null;
  attachment_url?: string | null;
  message_status_id?: string | null;
}
