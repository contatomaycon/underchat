export interface IScheduleContactValidated {
  contact_id: string;
  name: string;
  phone: string | null;
  phone_ddi: string | null;
  phone_partial: string | null;
}
