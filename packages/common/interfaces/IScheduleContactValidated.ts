export interface IScheduleContactValidated {
  contact_id: string;
  name: string;
  nickname: string | null;
  phone: string | null;
  phone_ddi: string | null;
  phone_partial: string | null;
  is_validated: boolean;
}
