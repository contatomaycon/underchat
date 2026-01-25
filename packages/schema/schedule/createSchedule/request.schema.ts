import { uploadFileRequestSchema } from '@core/schema/upload/request.schema';
import { Static, Type } from '@sinclair/typebox';

export const createScheduleRequestSchema = Type.Object({
  worker_id: Type.Union([
    Type.String({ format: 'uuid' }),
    Type.Object({
      value: Type.String({ format: 'uuid' }),
    }),
  ]),
  type: Type.Union([
    Type.String(),
    Type.Object({
      value: Type.String(),
    }),
  ]),
  send_to: Type.Union([
    Type.String(),
    Type.Object({
      value: Type.String(),
    }),
  ]),
  send_speed: Type.Optional(
    Type.Union([
      Type.String(),
      Type.Object({
        value: Type.String(),
      }),
    ])
  ),
  chatbot_id: Type.Optional(
    Type.Union([
      Type.String({ format: 'uuid' }),
      Type.Null(),
      Type.Object({
        value: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
      }),
    ])
  ),
  message: Type.Optional(
    Type.Union([
      Type.String(),
      Type.Null(),
      Type.Object({
        value: Type.Union([Type.String(), Type.Null()]),
      }),
    ])
  ),
  url: Type.Optional(Type.Union([uploadFileRequestSchema, Type.Null()])),
  send_date: Type.Union([
    Type.String(),
    Type.Object({
      value: Type.String(),
    }),
  ]),
  contact_ids: Type.Optional(
    Type.Object({
      value: Type.Union([Type.Array(Type.String()), Type.String()]),
    })
  ),
  contact_group_ids: Type.Optional(
    Type.Object({
      value: Type.Union([Type.Array(Type.String()), Type.String()]),
    })
  ),
});

export type CreateScheduleRequest = Static<typeof createScheduleRequestSchema>;
