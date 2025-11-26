export interface IUpdateUserAddress {
  country_id?: number | null;
  zip_code?: string | null;
  address1?: string | null;
  address1_partial?: string | null;
  address1_c?: string | null;
  address2?: string | null;
  address2_partial?: string | null;
  address2_c?: string | null;
  city_fiscal_code?: string | null;
  state_fiscal_code?: string | null;
  district?: string | null;
}
