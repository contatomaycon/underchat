import { Static, Type } from '@sinclair/typebox';
import { EInternalChatActivityState } from '@core/common/enums/internalChat/EInternalChatActivityState';

export const activityParamsSchema = Type.Object({});
export const activityQuerySchema = Type.Object({});
export const activityBodySchema = Type.Object({
  conversation_id: Type.String({ format: 'uuid' }),
  state: Type.String({ enum: Object.values(EInternalChatActivityState) }),
});

export type ActivityBody = Static<typeof activityBodySchema>;
