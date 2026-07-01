export type OfficialWhatsappInteractiveType =
  | 'button'
  | 'list'
  | 'cta_url'
  | 'location_request_message'
  | 'flow'
  | 'product'
  | 'product_list'
  | 'catalog_message'
  | 'carousel'
  | 'address_message'
  | 'call_permission_request';

export interface IOfficialWhatsappOutboundInteractiveMessage {
  type: OfficialWhatsappInteractiveType;
  interactive: Record<string, unknown>;
  summary?: string | null;
}
