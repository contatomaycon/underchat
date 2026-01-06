export interface IContactImportStatus {
  phone: string;
  phone_ddi?: string | null;
  phone_complete: string;
  status: 'valid' | 'invalid' | 'error' | 'duplicate' | 'no_phone';
  message?: string | null;
  contact_id?: string | null;
  name?: string | null;
  last_name?: string | null;
}
