export interface ICreateMessageTemplate {
  account_id: string;
  message: string;
  command: string;
  attachment_url?: string | null;
  message_status_id: string;
}
