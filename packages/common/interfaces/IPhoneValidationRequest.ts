export interface IPhoneValidationRequest {
  request_id: string;
  account_id: string;
  worker_id: string;
  phone: string;
  phone_ddi?: string | null;
}
