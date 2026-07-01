import { Static, Type } from '@sinclair/typebox';

export const officialCapabilitiesResponseSchema = Type.Object({
  has_official_online_channel: Type.Boolean(),
  has_non_official_linked_channel: Type.Boolean(),
  linked_channel_type: Type.Union([
    Type.Literal('official'),
    Type.Literal('non_official'),
    Type.Literal('mixed'),
    Type.Literal('none'),
  ]),
  can_use_official_nodes: Type.Boolean(),
});

export type OfficialCapabilitiesResponse = Static<
  typeof officialCapabilitiesResponseSchema
>;
