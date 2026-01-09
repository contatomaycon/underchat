export interface IWorkerConfigFields {
  show_attendee_name: boolean | null;
  show_worker_name: boolean | null;
  allow_attendance_only_online: boolean | null;
  generate_protocol_at_start: string | null;
  generate_protocol_at_transfer: string | null;
  generate_protocol_at_transfer_sector: string | null;
  generate_protocol_at_transfer_sector_and_user: string | null;
  show_message_on_call: string | null;
  send_message_on_finish_attendance: string | null;
  reject_call: boolean | null;
  auto_save_contacts: boolean | null;
  simultaneous_attendance: number | null;
}
