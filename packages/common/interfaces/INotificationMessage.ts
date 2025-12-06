export interface INotificationMessage {
  id: string;
  notification_id: string;
  message_key: {
    remote_jid: string | null;
  };
  account: {
    id: string;
    name: string | null;
  };
  worker: {
    id: string;
    name: string | null;
  };
  notification_type: {
    id: string;
    name: string;
  };
  message: string | null;
  name: string | null;
  phone: string | null;
  date: string;
}
