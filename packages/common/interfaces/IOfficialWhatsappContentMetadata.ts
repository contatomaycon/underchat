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

export interface IOfficialWhatsappContentMetadata {
  provider: 'meta_whatsapp';
  type: string;
  webhook_field?: string | null;
  message_id?: string | null;
  status?: string | null;
  echo?: boolean;
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
