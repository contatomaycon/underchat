import { uploadFileRequestSchema } from '@core/schema/upload/request.schema';
import { scheduleOfficialTemplateFieldSchema } from '@core/schema/schedule/officialTemplate.schema';
import { Static, Type } from '@sinclair/typebox';

export const editScheduleParamsRequestSchema = Type.Object({
  schedule_id: Type.String({ format: 'uuid' }),
});

export type EditScheduleParamsRequest = Static<
  typeof editScheduleParamsRequestSchema
>;

export const updateScheduleRequestSchema = Type.Object({
  worker_id: Type.Optional(
    Type.Union([
      Type.String({ format: 'uuid' }),
      Type.Null(),
      Type.Object({
        value: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
      }),
    ])
  ),
  type: Type.Optional(
    Type.Union([
      Type.String(),
      Type.Null(),
      Type.Object({
        value: Type.Union([Type.String(), Type.Null()]),
      }),
    ])
  ),
  send_to: Type.Optional(
    Type.Union([
      Type.String(),
      Type.Null(),
      Type.Object({
        value: Type.Union([Type.String(), Type.Null()]),
      }),
    ])
  ),
  send_speed: Type.Optional(
    Type.Union([
      Type.String(),
      Type.Null(),
      Type.Object({
        value: Type.Union([Type.String(), Type.Null()]),
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
  official_template: scheduleOfficialTemplateFieldSchema,
  send_date: Type.Optional(
    Type.Union([
      Type.String(),
      Type.Null(),
      Type.Object({
        value: Type.Union([Type.String(), Type.Null()]),
      }),
    ])
  ),
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

export type UpdateScheduleRequest = Static<typeof updateScheduleRequestSchema>;
