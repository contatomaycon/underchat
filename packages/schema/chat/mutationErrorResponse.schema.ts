import { Type } from '@sinclair/typebox';

/** Shared envelope for documented chat mutation domain errors. */
export function chatMutationErrorResponseSchema(description: string) {
  return Type.Object(
    {
      id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      status: Type.Boolean({ const: false }),
      message: Type.String(),
      data: Type.Null(),
    },
    { description }
  );
}
