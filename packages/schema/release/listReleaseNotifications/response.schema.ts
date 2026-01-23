import { listReleaseResponseSchema } from '@core/schema/release/listRelease/response.schema';
import { Static, Type } from '@sinclair/typebox';

export const listReleaseNotificationsResponseSchema = Type.Object({
  unread_count: Type.Number(),
  results: Type.Array(listReleaseResponseSchema),
});

export type ListReleaseNotificationsResponse = Static<
  typeof listReleaseNotificationsResponseSchema
>;
