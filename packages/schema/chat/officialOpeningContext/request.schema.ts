import { Static, Type } from '@sinclair/typebox';

export const officialOpeningContextRequestSchema = Type.Object({
  worker_id: Type.String({ format: 'uuid' }),
  contact_id: Type.String({ format: 'uuid' }),
});

export type OfficialOpeningContextRequest = Static<
  typeof officialOpeningContextRequestSchema
>;
