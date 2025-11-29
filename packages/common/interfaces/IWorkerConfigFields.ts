export interface IWorkerConfigFields {
  is_automatic_attendance: boolean | null;
  show_attendee_name: boolean | null;
  show_worker_name: boolean | null;
  allow_attendance_only_online: boolean | null;
  generate_protocol_at_ura: string | null;
  generate_protocol_at_start: string | null;
  generate_protocol_at_transfer: string | null;
  show_message_on_call: string | null;
  auto_save_contacts: boolean | null;
  simultaneous_attendance: number | null;
}
