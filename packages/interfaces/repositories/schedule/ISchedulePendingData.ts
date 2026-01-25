export interface ISchedulePendingData {
  schedule_id: string;
  account_id: string;
  account_name: string;
  worker_id: string;
  worker_name: string;
  type: string;
  send_to: string;
  send_speed: string;
  chatbot_id: string | null;
  message: string | null;
  url: string | null;
  mimetype: string | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  send_date: string;
}
