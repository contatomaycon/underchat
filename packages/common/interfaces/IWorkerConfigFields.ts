export interface IWorkerConfigFields {
  is_automatic_attendance: boolean | null;
  show_attendee_name: boolean | null;
  show_worker_name: boolean | null;
  generate_protocol_at_ura: string | null;
  generate_protocol_at_start: string | null;
  generate_protocol_at_transfer: string | null;
}
