export interface INotificationMessage {
  id: string;
  operation_id?: string;
  user_id?: string;
  notification_id: string;
  message_key: {
    remote_jid?: string | null;
    phone_ddi: string;
    phone_number: string;
  };
  account?: {
    id: string;
    name: string | null;
  };
  worker: {
    id: string | null;
    name: string | null;
  };
  notification_type: {
    id: string;
    name: string;
  };
  message_whatsapp: string | null;
  message_email: string | null;
  email_subject: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  date: string;
}
