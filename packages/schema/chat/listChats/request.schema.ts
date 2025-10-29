import { EChatStatus } from '@core/common/enums/EChatStatus';
import { Static, Type } from '@sinclair/typebox';
import { pagingRequestSchema } from '@core/schema/common/pagingRequestSchema';

export const listChatsQuerySchema = Type.Object({
  ...pagingRequestSchema.properties,
  status: Type.String({ enum: Object.values(EChatStatus) }),
});

export type ListChatsQuery = Static<typeof listChatsQuerySchema>;
