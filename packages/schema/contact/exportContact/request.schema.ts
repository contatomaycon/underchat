import { Static, Type } from '@sinclair/typebox';

export const exportContactRequestSchema = Type.Object({
  contact_ids: Type.Optional(
    Type.Union([
      Type.String(),
      Type.Array(Type.String({ format: 'uuid' })),
      Type.Null(),
    ])
  ),
});

export type ExportContactRequest = Static<typeof exportContactRequestSchema>;
