export interface IMappedWebhookData {
  first_name?: string;
  last_name?: string;
  nickname?: string;
  birthday?: string;
  email?: string;
  phone_ddi?: string;
  phone?: string;
  notes?: string;
  labels?: string[];
  message_type?: 'message' | 'chatbot';
  message?: string;
  transfer_sector_id?: string;
  transfer_sector_user_id?: string;
  transfer_user_id?: string;
  chatbot_id?: string;
}
