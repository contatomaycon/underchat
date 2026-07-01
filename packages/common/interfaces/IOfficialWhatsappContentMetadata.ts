export interface IOfficialWhatsappInteractiveMetadata {
  type: string | null;
  id?: string | null;
  title?: string | null;
  description?: string | null;
}

export interface IOfficialWhatsappOrderItemMetadata {
  product_retailer_id?: string | null;
  quantity?: string | number | null;
  item_price?: string | number | null;
  currency?: string | null;
}

export interface IOfficialWhatsappOrderMetadata {
  catalog_id?: string | null;
  text?: string | null;
  product_items?: IOfficialWhatsappOrderItemMetadata[];
}

export type OfficialWhatsappDisplayKind =
  | 'button'
  | 'list'
  | 'cta_url'
  | 'location_request'
  | 'flow'
  | 'product'
  | 'product_list'
  | 'catalog'
  | 'carousel'
  | 'address'
  | 'template'
  | 'order'
  | 'reply'
  | 'referral'
  | 'system'
  | 'unsupported'
  | 'call_permission_request';

export interface IOfficialWhatsappDisplayAction {
  id?: string | null;
  type?: string | null;
  title?: string | null;
  description?: string | null;
  url?: string | null;
  phone_number?: string | null;
}

export interface IOfficialWhatsappDisplaySection {
  id?: string | null;
  title?: string | null;
  rows?: IOfficialWhatsappDisplayAction[];
  items?: IOfficialWhatsappDisplayAction[];
}

export interface IOfficialWhatsappDisplayMedia {
  type?: string | null;
  id?: string | null;
  url?: string | null;
  link?: string | null;
  caption?: string | null;
}

export interface IOfficialWhatsappDisplayCard {
  title?: string | null;
  body?: string | null;
  footer?: string | null;
  media?: IOfficialWhatsappDisplayMedia | null;
  actions?: IOfficialWhatsappDisplayAction[];
  items?: IOfficialWhatsappDisplayAction[];
}

export interface IOfficialWhatsappDisplayMetadata {
  kind: OfficialWhatsappDisplayKind;
  raw_type?: string | null;
  title?: string | null;
  body?: string | null;
  footer?: string | null;
  action_label?: string | null;
  actions?: IOfficialWhatsappDisplayAction[];
  sections?: IOfficialWhatsappDisplaySection[];
  items?: IOfficialWhatsappDisplayAction[];
  cards?: IOfficialWhatsappDisplayCard[];
  media?: IOfficialWhatsappDisplayMedia | null;
  submitted_data?: Record<string, unknown> | null;
}

export interface IOfficialWhatsappContentMetadata {
  provider: 'meta_whatsapp';
  type: string;
  webhook_field?: string | null;
  message_id?: string | null;
  status?: string | null;
  echo?: boolean;
  display?: IOfficialWhatsappDisplayMetadata | null;
  interactive?: IOfficialWhatsappInteractiveMetadata | null;
  order?: IOfficialWhatsappOrderMetadata | null;
  button?: {
    text?: string | null;
    payload?: string | null;
  } | null;
  unsupported?: {
    type?: string | null;
    reason?: string | null;
  } | null;
  referral?: Record<string, unknown> | null;
  errors?: Array<Record<string, unknown>>;
  raw?: Record<string, unknown>;
}
