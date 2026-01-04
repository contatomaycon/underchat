export interface IUpdateContact {
  label_template_id?: string | null;
  name?: string | null;
  last_name?: string | null;
  email?: string | null;
  email_partial?: string | null;
  email_c?: string | null;
  phone_ddi?: string | null;
  phone?: string | null;
  phone_partial?: string | null;
  phone_c?: string | null;
  nickname?: string | null;
  photo?: string | null;
  birthday?: string | null;
  notes?: string | null;
  contact_document_type_id?: string | null;
  document?: string | null;
  document_partial?: string | null;
  document_c?: string | null;
  is_valided: boolean;
}
