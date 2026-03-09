import { Static, Type } from '@sinclair/typebox';

const channelStatusItemSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  status: Type.Union([
    Type.Object({
      id: Type.String(),
      name: Type.Union([Type.String(), Type.Null()]),
    }),
    Type.Null(),
  ]),
});

export const listChannelsStatusFinalResponseSchema = Type.Array(
  channelStatusItemSchema
);

export type ListChannelsStatusResponse = Static<typeof channelStatusItemSchema>;
export type ListChannelsStatusFinalResponse = Static<
  typeof listChannelsStatusFinalResponseSchema
>;
