export interface ITwoFactorData {
  two_factor_id: string;
  user_id: string | null;
  phone_ddi: string | null;
  phone: string | null;
  phone_c: string | null;
  email: string | null;
  email_c: string | null;
  code: string;
  token: string;
  worker_id: string | null;
  worker_number: string | null;
  validation_context: string | null;
  validated_at: string | null;
  created_at: string | null;
  deleted_at: string | null;
}
