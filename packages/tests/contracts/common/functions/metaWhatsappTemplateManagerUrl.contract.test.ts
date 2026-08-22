import { buildMetaWhatsappTemplateManagerUrl } from '@core/common/functions/metaWhatsappTemplateManagerUrl';

describe('buildMetaWhatsappTemplateManagerUrl', () => {
  it('binds the manager to the selected WABA and business', () => {
    const result = buildMetaWhatsappTemplateManagerUrl({
      wabaId: '1559502645897944',
      businessId: '294792833281367',
    });

    expect(result).not.toBeNull();

    const url = new URL(result as string);

    expect(url.origin).toBe('https://business.facebook.com');
    expect(url.pathname).toBe('/latest/whatsapp_manager/message_templates');
    expect(url.searchParams.get('asset_id')).toBe('1559502645897944');
    expect(url.searchParams.get('business_id')).toBe('294792833281367');
    expect(url.searchParams.get('tab')).toBe('message-templates');
    expect(url.searchParams.get('nav_ref')).toBe('whatsapp_manager');
  });

  it('still targets the WABA when the optional business id is absent', () => {
    const result = buildMetaWhatsappTemplateManagerUrl({ wabaId: '123456' });
    const url = new URL(result as string);

    expect(url.searchParams.get('asset_id')).toBe('123456');
    expect(url.searchParams.has('business_id')).toBe(false);
  });

  it.each([undefined, null, '', 'invalid-id'])(
    'does not build a generic manager URL for an invalid WABA id (%s)',
    (wabaId) => {
      expect(buildMetaWhatsappTemplateManagerUrl({ wabaId })).toBeNull();
    }
  );
});
