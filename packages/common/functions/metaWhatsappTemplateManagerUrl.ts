const META_WHATSAPP_TEMPLATE_MANAGER_URL =
  'https://business.facebook.com/latest/whatsapp_manager/message_templates';

const normalizeMetaIdentifier = (value?: string | null): string | null => {
  const normalized = value?.trim();

  return normalized && /^\d+$/.test(normalized) ? normalized : null;
};

export const buildMetaWhatsappTemplateManagerUrl = (input: {
  wabaId?: string | null;
  businessId?: string | null;
}): string | null => {
  const wabaId = normalizeMetaIdentifier(input.wabaId);

  if (!wabaId) {
    return null;
  }

  const url = new URL(META_WHATSAPP_TEMPLATE_MANAGER_URL);
  const businessId = normalizeMetaIdentifier(input.businessId);

  url.searchParams.set('asset_id', wabaId);

  if (businessId) {
    url.searchParams.set('business_id', businessId);
  }

  url.searchParams.set('tab', 'message-templates');
  url.searchParams.set('nav_ref', 'whatsapp_manager');

  return url.toString();
};
