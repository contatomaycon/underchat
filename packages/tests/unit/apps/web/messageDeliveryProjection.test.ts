import { mergeMessageDeliveryProjection } from '@core/common/functions/messageDeliveryProjection';

describe('messageDeliveryProjection', () => {
  it('lets a definitive Meta failure override an earlier sent acknowledgement', () => {
    expect(
      mergeMessageDeliveryProjection(
        {
          delivery_status: 'failed',
          provider_error_code: 131047,
          provider_status_at: '2026-08-16T19:49:59.000Z',
          summary: {
            is_sent: false,
            is_delivered: false,
            is_seen: false,
            is_sent_to_internal: false,
          },
        },
        {
          delivery_status: 'sent',
          summary: {
            is_sent: true,
            is_delivered: false,
            is_seen: false,
            is_sent_to_internal: true,
          },
        }
      )
    ).toEqual({
      delivery_status: 'failed',
      provider_error_code: 131047,
      provider_status_at: '2026-08-16T19:49:59.000Z',
      summary: {
        is_sent: false,
        is_delivered: false,
        is_seen: false,
        is_sent_to_internal: false,
      },
    });
  });

  it('does not let a late sent acknowledgement erase a definitive failure', () => {
    expect(
      mergeMessageDeliveryProjection(
        {
          delivery_status: 'sent',
          summary: {
            is_sent: true,
            is_delivered: false,
            is_seen: false,
            is_sent_to_internal: true,
          },
        },
        {
          delivery_status: 'failed',
          provider_error_code: 131047,
          summary: {
            is_sent: false,
            is_delivered: false,
            is_seen: false,
            is_sent_to_internal: false,
          },
        }
      ).delivery_status
    ).toBe('failed');
  });

  it('allows delivered and read receipts to resolve a previous failure', () => {
    const result = mergeMessageDeliveryProjection(
      {
        delivery_status: 'read',
        summary: {
          is_sent: true,
          is_delivered: true,
          is_seen: true,
          is_sent_to_internal: true,
        },
      },
      {
        delivery_status: 'failed',
        provider_error_code: 131047,
        summary: {
          is_sent: false,
          is_delivered: false,
          is_seen: false,
          is_sent_to_internal: false,
        },
      }
    );

    expect(result.delivery_status).toBe('read');
    expect(result.provider_error_code).toBeNull();
    expect(result.summary?.is_seen).toBe(true);
  });
});
