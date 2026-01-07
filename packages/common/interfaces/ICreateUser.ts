export interface ICreateUser {
  account_id: string;
  email: string;
  email_partial: string;
  email_c: string;
  password: string;
  user_status_id?: string;
}
