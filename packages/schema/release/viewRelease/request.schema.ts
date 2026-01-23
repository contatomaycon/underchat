import { Static, Type } from '@sinclair/typebox';

export const viewReleaseParamsRequestSchema = Type.Object({
  release_id: Type.String({ format: 'uuid' }),
});

export type ViewReleaseParamsRequest = Static<
  typeof viewReleaseParamsRequestSchema
>;
