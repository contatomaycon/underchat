import { Static, Type } from '@sinclair/typebox';

export const officialTemplatesRequestSchema = Type.Object({
  chatbot_id: Type.String({ format: 'uuid' }),
});

export type OfficialTemplatesRequest = Static<
  typeof officialTemplatesRequestSchema
>;
