export interface ICreateUserInfo {
  phone_ddi: string | null;
  phone: string | null;
  phone_partial: string | null;
  phone_c: string | null;
  photo?: string | null;
  name: string;
  last_name: string;
  birth_date?: string | null;
}
