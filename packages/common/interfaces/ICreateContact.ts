export interface ICreateContact {
  account_id?: string | null;
  label_template_id?: string | null;
  name: string;
  last_name?: string | null;
  email?: string | null;
  email_partial?: string | null;
  phone_ddi?: string | null;
  phone?: string | null;
  phone_partial?: string | null;
  nickname?: string | null;
  birthday?: string | null;
  notes?: string | null;
}
