export interface ICreateUserAddress {
  country_id: number;
  zip_code: string;
  address1: string;
  address1_partial: string;
  address2?: string | null;
  address2_partial?: string | null;
  city: string;
  state: string;
  district: string;
}
