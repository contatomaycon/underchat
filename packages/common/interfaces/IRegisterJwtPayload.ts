export interface IRegisterJwtPayload {
  token: string;
  email_c: string;
  phone_c: string;
  two_factor_id?: string;
}
