export interface ICreateUserAddress {
  country_id: number;
  zip_code: string;
  address1: string;
  address1_partial: string;
  address1_c: string;
  address2?: string | null;
  address2_partial?: string | null;
  address2_c?: string | null;
  city_fiscal_code: string | null;
  state_fiscal_code: string | null;
  district: string;
}
