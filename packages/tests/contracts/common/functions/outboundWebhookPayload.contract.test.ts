import {
  buildOutboundWebhookEnvelope,
  normalizeOutboundWebhookChannelIds,
  sanitizeOutboundWebhookContactChanges,
  sanitizeOutboundWebhookValue,
  serializePublicContact,
} from '@core/common/functions/outboundWebhookPayload';

describe('outbound webhook payload sanitization contract', () => {
  it('redacts snake-case, camel-case and hyphenated credentials recursively', () => {
    const sanitized = sanitizeOutboundWebhookValue({
      access_token: 'one',
      refreshToken: 'two',
      'api-key': 'three',
      nested: {
        privateKey: 'four',
        jwt: 'five',
        raw: { provider_payload: 'six' },
        safe: 'visible',
      },
    });

    expect(sanitized).toEqual({ nested: { safe: 'visible' } });
  });

  it('ignores prototype mutation keys and bounds object fan-out', () => {
    const wideObject = Object.fromEntries(
      Array.from({ length: 2_001 }, (_, index) => [`field_${index}`, index])
    );
    const malicious = JSON.parse(
      '{"__proto__":{"polluted":true},"constructor":"hidden","safe":true}'
    ) as Record<string, unknown>;

    const sanitizedWide = sanitizeOutboundWebhookValue(wideObject);
    const sanitizedMalicious = sanitizeOutboundWebhookValue(malicious);

    expect(Object.keys(sanitizedWide as Record<string, unknown>)).toHaveLength(
      2_000
    );
    expect(sanitizedMalicious).toEqual({ safe: true });
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it('removes inline base64 data URLs while preserving public media metadata', () => {
    const sanitized = sanitizeOutboundWebhookValue({
      video: {
        url: 'https://cdn.example.com/video.mp4',
        mimetype: 'video/mp4',
        thumbnail: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==',
      },
      quoted: {
        thumbnail: '  data:image/png;charset=utf-8;base64,iVBORw0KGgo=',
      },
      text: 'data URLs mentioned in ordinary text remain visible',
    });

    expect(sanitized).toEqual({
      video: {
        url: 'https://cdn.example.com/video.mp4',
        mimetype: 'video/mp4',
      },
      quoted: {},
      text: 'data URLs mentioned in ordinary text remain visible',
    });
  });

  it('removes provider thumbnail bytes even when stored as plain base64', () => {
    const sanitized = sanitizeOutboundWebhookValue({
      link_preview: {
        jpegThumbnail: '/9j/4AAQSkZJRgABAQ==',
        highQualityThumbnail: 'iVBORw0KGgoAAAANSUhEUg==',
        originalThumbnailUrl: 'https://cdn.example.com/preview.jpg',
        title: 'Public title',
      },
    });

    expect(sanitized).toEqual({
      link_preview: {
        originalThumbnailUrl: 'https://cdn.example.com/preview.jpg',
        title: 'Public title',
      },
    });
  });

  it('sanitizes every producer payload again at the envelope boundary', () => {
    const envelope = buildOutboundWebhookEnvelope({
      id: '01900000-0000-7000-8000-000000000001',
      type: 'contact.updated',
      accountId: '01900000-0000-7000-8000-000000000002',
      aggregate: { type: 'contact', id: 'contact-1' },
      data: {
        contact: {
          name: 'Visible',
          accessToken: 'must-not-leak',
        },
      },
      previous: {
        contact: {
          name: 'Previous',
          authorization: 'must-not-leak',
        },
      },
      source: 'contract_test',
      channelIds: [
        '01900000-0000-7000-8000-000000000004',
        '01900000-0000-7000-8000-000000000003',
        '01900000-0000-7000-8000-000000000004',
      ],
    });

    expect(envelope.data).toEqual({ contact: { name: 'Visible' } });
    expect(envelope.previous).toEqual({ contact: { name: 'Previous' } });
    expect(envelope.context?.channel_ids).toEqual([
      '01900000-0000-7000-8000-000000000003',
      '01900000-0000-7000-8000-000000000004',
    ]);
  });

  it('requires a non-empty UUID channel scope', () => {
    expect(() => normalizeOutboundWebhookChannelIds([])).toThrow(
      'outbound_webhook_event_channel_scope_required'
    );
    expect(() => normalizeOutboundWebhookChannelIds(['not-a-uuid'])).toThrow(
      'outbound_webhook_event_invalid_channel_scope'
    );
  });

  it('never exposes encrypted contact repository fields when partial projections exist', () => {
    const serialized = serializePublicContact({
      contact_id: 'contact-1',
      email: 'encrypted-email',
      email_partial: 'm***@example.com',
      phone: 'encrypted-phone',
      phone_partial: '*****9999',
      document: 'encrypted-document',
      document_partial: '***1234',
      is_valided: true,
    });

    expect(serialized).toEqual(
      expect.objectContaining({
        email: 'm***@example.com',
        phone: '*****9999',
        document: '***1234',
        is_valided: true,
      })
    );
    expect(JSON.stringify(serialized)).not.toContain('encrypted-');
  });

  it('masks contact PII and removes private fingerprints recursively from changes', () => {
    const sanitized = sanitizeOutboundWebhookContactChanges({
      payload: {
        phone: '11999991234',
        email: { value: 'john@example.com' },
        document: '12345678901',
        phone_c: 'private-phone-fingerprint',
        emailCEncrypted: 'private-email-ciphertext',
      },
      phone_ddi: '55',
      origin: 'chatbot_flow',
    });

    expect(sanitized).toEqual({
      payload: {
        phone: '(11) *****-1234',
        email: { value: 'jo**@example.com' },
        document: '123.***.***-01',
      },
      phone_ddi: '55',
      origin: 'chatbot_flow',
    });
    expect(JSON.stringify(sanitized)).not.toContain('private-');
    expect(JSON.stringify(sanitized)).not.toContain('john@example.com');
    expect(JSON.stringify(sanitized)).not.toContain('11999991234');
  });

  it('masks intended plaintext snapshots deterministically and supports nested document types', () => {
    const serialized = serializePublicContact({
      contact_id: 'contact-1',
      email: 'john@example.com',
      phone: '11999991234',
      document: '12345678901',
      contact_document_type: {
        contact_document_type_id: 'document-type-1',
        name: 'CPF',
      },
    });

    expect(serialized).toEqual(
      expect.objectContaining({
        email: 'jo**@example.com',
        phone: '(11) *****-1234',
        document: '123.***.***-01',
        contact_document_type_id: 'document-type-1',
      })
    );
    expect(serialized).not.toHaveProperty('label_templates');
    expect(serialized).not.toHaveProperty('channel_ids');
    expect(serialized).not.toHaveProperty('contact_groups');
  });
});
