import { Static, TSchema, Type } from '@sinclair/typebox';

const nullableStringSchema = Type.Union([Type.String(), Type.Null()]);
const nullableNumberSchema = Type.Union([Type.Number(), Type.Null()]);
const nullableBooleanSchema = Type.Union([Type.Boolean(), Type.Null()]);
const metaRawRecordSchema = Type.Record(Type.String(), Type.Unknown());

const metaSectionErrorSchema = Type.Object({
  message: Type.String(),
  type: nullableStringSchema,
  code: nullableNumberSchema,
  error_subcode: nullableNumberSchema,
});

const metaSectionSchema = <T extends TSchema>(dataSchema: T) =>
  Type.Object({
    available: Type.Boolean(),
    data: Type.Union([dataSchema, Type.Null()]),
    error: Type.Union([metaSectionErrorSchema, Type.Null()]),
  });

const metaHealthStatusSchema = Type.Union([metaRawRecordSchema, Type.Null()]);

const whatsappOfficialPhoneNumberSummarySchema = Type.Object({
  id: Type.String(),
  display_phone_number: nullableStringSchema,
  verified_name: nullableStringSchema,
  quality_rating: nullableStringSchema,
  status: nullableStringSchema,
  throughput_level: nullableStringSchema,
  account_mode: nullableStringSchema,
  code_verification_status: nullableStringSchema,
  messaging_limit_tier: nullableStringSchema,
  is_official_business_account: nullableBooleanSchema,
  last_onboarded_time: nullableStringSchema,
});

const whatsappOfficialPhoneNumberHealthSchema = Type.Object({
  id: Type.String(),
  display_phone_number: nullableStringSchema,
  verified_name: nullableStringSchema,
  quality_rating: nullableStringSchema,
  status: nullableStringSchema,
  throughput_level: nullableStringSchema,
  account_mode: nullableStringSchema,
  code_verification_status: nullableStringSchema,
  messaging_limit_tier: nullableStringSchema,
  is_official_business_account: nullableBooleanSchema,
  last_onboarded_time: nullableStringSchema,
  is_on_biz_app: nullableBooleanSchema,
  is_pin_enabled: nullableBooleanSchema,
  is_preverified_number: nullableBooleanSchema,
  platform_type: nullableStringSchema,
  name_status: nullableStringSchema,
  quality_score: Type.Union([metaRawRecordSchema, Type.Null()]),
  webhook_configuration: Type.Union([metaRawRecordSchema, Type.Null()]),
  health_status: metaHealthStatusSchema,
});

const whatsappOfficialWabaHealthSchema = Type.Object({
  id: Type.String(),
  name: nullableStringSchema,
  currency: nullableStringSchema,
  timezone_id: nullableStringSchema,
  business_verification_status: nullableStringSchema,
  country: nullableStringSchema,
  is_enabled_for_insights: nullableBooleanSchema,
  marketing_messages_lite_api_status: nullableStringSchema,
  marketing_messages_onboarding_status: nullableStringSchema,
  health_status: metaHealthStatusSchema,
});

const whatsappOfficialMessageAnalyticsDataPointSchema = Type.Object({
  start: nullableStringSchema,
  end: nullableStringSchema,
  sent: Type.Number(),
  delivered: Type.Number(),
  raw: metaRawRecordSchema,
});

const whatsappOfficialConversationAnalyticsDataPointSchema = Type.Object({
  start: nullableStringSchema,
  end: nullableStringSchema,
  conversations: Type.Number(),
  cost: Type.Number(),
  conversation_type: nullableStringSchema,
  conversation_direction: nullableStringSchema,
  pricing_type: nullableStringSchema,
  raw: metaRawRecordSchema,
});

const whatsappOfficialMessageAnalyticsSchema = Type.Object({
  data_points: Type.Array(whatsappOfficialMessageAnalyticsDataPointSchema),
  totals: Type.Object({
    sent: Type.Number(),
    delivered: Type.Number(),
  }),
});

const whatsappOfficialConversationAnalyticsSchema = Type.Object({
  data_points: Type.Array(whatsappOfficialConversationAnalyticsDataPointSchema),
  totals: Type.Object({
    conversations: Type.Number(),
    cost: Type.Number(),
  }),
});

const whatsappOfficialTokenDiagnosticSchema = Type.Object({
  valid: Type.Boolean(),
  app_matches_config: Type.Boolean(),
  type: nullableStringSchema,
  issued_at: nullableStringSchema,
  expires_at: nullableStringSchema,
  data_access_expires_at: nullableStringSchema,
  does_not_expire: Type.Boolean(),
  scopes: Type.Array(Type.String()),
  required_scopes: Type.Array(Type.String()),
  missing_scopes: Type.Array(Type.String()),
});

const whatsappOfficialWebhookSubscriptionDiagnosticSchema = Type.Object({
  subscribed: Type.Boolean(),
  subscription_count: Type.Number(),
});

export const whatsappOfficialHealthResponseSchema = Type.Object({
  worker_id: Type.String(),
  account_id: Type.String(),
  fetched_at: Type.String(),
  period: Type.Object({
    start: Type.String(),
    end: Type.String(),
    days: Type.Number(),
  }),
  connection: Type.Object({
    waba_id: Type.String(),
    phone_number_id: Type.String(),
    api_version: Type.String(),
  }),
  local: Type.Object({
    open_conversations: Type.Number(),
  }),
  phone_numbers: metaSectionSchema(
    Type.Object({
      total: Type.Number(),
      results: Type.Array(whatsappOfficialPhoneNumberSummarySchema),
    })
  ),
  phone_number: metaSectionSchema(whatsappOfficialPhoneNumberHealthSchema),
  waba: metaSectionSchema(whatsappOfficialWabaHealthSchema),
  analytics: Type.Object({
    messages: metaSectionSchema(whatsappOfficialMessageAnalyticsSchema),
    conversations: metaSectionSchema(
      whatsappOfficialConversationAnalyticsSchema
    ),
  }),
  diagnostics: Type.Object({
    reauthentication_required: Type.Boolean(),
    token: metaSectionSchema(whatsappOfficialTokenDiagnosticSchema),
    webhook_subscription: metaSectionSchema(
      whatsappOfficialWebhookSubscriptionDiagnosticSchema
    ),
  }),
  warnings: Type.Array(Type.String()),
});

export type WhatsappOfficialHealthResponse = Static<
  typeof whatsappOfficialHealthResponseSchema
>;

export type WhatsappOfficialHealthSectionError = Static<
  typeof metaSectionErrorSchema
>;
