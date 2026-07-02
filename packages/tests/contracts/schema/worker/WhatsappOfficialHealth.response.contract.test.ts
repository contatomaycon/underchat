import { Value } from '@sinclair/typebox/value';
import { whatsappOfficialHealthResponseSchema } from '@core/schema/worker/whatsappOfficialHealth/response.schema';

describe('WhatsappOfficialHealthResponse schema', () => {
  it('accepts a normalized Meta account health payload', () => {
    const payload = {
      worker_id: 'worker-1',
      account_id: 'account-1',
      fetched_at: '2026-07-02T12:00:00.000Z',
      period: {
        start: '2026-06-02T12:00:00.000Z',
        end: '2026-07-02T12:00:00.000Z',
        days: 30,
      },
      connection: {
        waba_id: 'waba-1',
        phone_number_id: 'phone-1',
        api_version: 'v25.0',
      },
      local: {
        open_conversations: 3,
      },
      phone_numbers: {
        available: true,
        data: {
          total: 1,
          results: [
            {
              id: 'phone-1',
              display_phone_number: '+55 61 9203-7138',
              verified_name: 'Underchat',
              quality_rating: 'GREEN',
              status: 'CONNECTED',
              throughput_level: 'STANDARD',
              account_mode: 'LIVE',
              code_verification_status: 'VERIFIED',
              messaging_limit_tier: 'TIER_250',
              is_official_business_account: false,
              last_onboarded_time: null,
            },
          ],
        },
        error: null,
      },
      phone_number: {
        available: true,
        data: {
          id: 'phone-1',
          display_phone_number: '+55 61 9203-7138',
          verified_name: 'Underchat',
          quality_rating: 'GREEN',
          status: 'CONNECTED',
          throughput_level: 'STANDARD',
          account_mode: 'LIVE',
          code_verification_status: 'VERIFIED',
          messaging_limit_tier: 'TIER_250',
          is_official_business_account: false,
          last_onboarded_time: null,
          is_on_biz_app: true,
          is_pin_enabled: true,
          is_preverified_number: false,
          platform_type: 'CLOUD_API',
          name_status: 'AVAILABLE_WITHOUT_REVIEW',
          quality_score: null,
          webhook_configuration: null,
          health_status: {
            can_send_message: 'LIMITED',
            entities: [],
          },
        },
        error: null,
      },
      waba: {
        available: true,
        data: {
          id: 'waba-1',
          name: 'Underchat',
          currency: 'USD',
          timezone_id: '25',
          business_verification_status: 'not_verified',
          country: null,
          is_enabled_for_insights: true,
          marketing_messages_lite_api_status: 'ONBOARDED',
          marketing_messages_onboarding_status: 'ONBOARDED',
          health_status: {
            can_send_message: 'LIMITED',
            entities: [],
          },
        },
        error: null,
      },
      analytics: {
        messages: {
          available: true,
          data: {
            data_points: [
              {
                start: '10',
                end: '20',
                sent: 67,
                delivered: 67,
                raw: {
                  sent: 67,
                  delivered: 67,
                },
              },
            ],
            totals: {
              sent: 67,
              delivered: 67,
            },
          },
          error: null,
        },
        conversations: {
          available: true,
          data: {
            data_points: [],
            totals: {
              conversations: 0,
              cost: 0,
            },
          },
          error: null,
        },
      },
      warnings: ['Meta did not return conversation analytics for this period.'],
    };

    expect(Value.Check(whatsappOfficialHealthResponseSchema, payload)).toBe(
      true
    );
  });
});
