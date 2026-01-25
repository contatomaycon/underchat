export interface IUpdateSchedule {
  schedule_id: string;
  worker_id?: string | null;
  type?: string | null;
  send_to?: string | null;
  send_speed?: string | null;
  chatbot_id?: string | null;
  message?: string | null;
  url?: string | null;
  mimetype?: string | null;
  duration?: number | null;
  width?: number | null;
  height?: number | null;
  send_date?: string | null;
  contact_ids?: string[];
  contact_group_ids?: string[];
}
