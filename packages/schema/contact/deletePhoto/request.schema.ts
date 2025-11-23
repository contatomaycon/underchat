import { Static, Type } from '@sinclair/typebox';

export const deleteContactPhotoRequestSchema = Type.Object({
  contact_id: Type.String({ format: 'uuid' }),
});

export type DeleteContactPhotoRequest = Static<
  typeof deleteContactPhotoRequestSchema
>;
