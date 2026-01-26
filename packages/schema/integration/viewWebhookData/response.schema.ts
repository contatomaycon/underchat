import { Static, Type } from '@sinclair/typebox';

export const viewWebhookDataResponseSchema = Type.Object({
  data: Type.Any(),
});

export type ViewWebhookDataResponse = Static<
  typeof viewWebhookDataResponseSchema
>;
