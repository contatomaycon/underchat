import { Static, Type } from '@sinclair/typebox';

export const officialCapabilitiesRequestSchema = Type.Object({
  chatbot_id: Type.String(),
});

export type OfficialCapabilitiesRequest = Static<
  typeof officialCapabilitiesRequestSchema
>;
