import { EChatStatus } from '@core/common/enums/EChatStatus';
import { Static, Type } from '@sinclair/typebox';

export const listChatsQuerySchema = Type.Object({
  from: Type.Optional(Type.Number({ default: 0 })),
  size: Type.Optional(Type.Number({ default: 100 })),
  status: Type.String({ enum: Object.values(EChatStatus) }),
});

export type ListChatsQuery = Static<typeof listChatsQuerySchema>;
