export interface IWorkerConfigValue {
  worker_config_id: string;
  worker_id: string;
  is_automatic_attendance: boolean | null;
  show_attendee_name: boolean | null;
  show_worker_name: boolean | null;
  allow_attendance_only_online: boolean | null;
  simultaneous_attendance: number | null;
  generate_protocol_at_start: string | null;
  generate_protocol_at_transfer: string | null;
  show_message_on_call: string | null;
  send_message_on_finish_attendance: string | null;
  reject_call: boolean | null;
  auto_save_contacts: boolean | null;
  chatbot_id: string | null;
  created_at: string | null;
  updated_at: string | null;
}
