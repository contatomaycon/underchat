export interface ICreateUserInfo {
  phone_ddi: string;
  phone: string;
  phone_partial: string;
  name: string;
  last_name: string;
  birth_date?: string | null;
}
