export interface IUserDataForForgotPassword {
  user_id: string;
  account_id: string;
  email: string | null;
  phone: string | null;
  phone_ddi: string | null;
  name: string | null;
}
