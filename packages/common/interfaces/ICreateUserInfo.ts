export interface ICreateUserInfo {
  phone_ddi: string;
  phone: string;
  phone_partial: string;
  phone_c: string;
  name: string;
  last_name: string;
  birth_date?: string | null;
}
