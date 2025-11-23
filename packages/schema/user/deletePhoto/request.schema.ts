import { Static, Type } from '@sinclair/typebox';

export const deletePhotoParamsSchema = Type.Object({
  user_id: Type.String(),
});

export type DeletePhotoParams = Static<typeof deletePhotoParamsSchema>;
