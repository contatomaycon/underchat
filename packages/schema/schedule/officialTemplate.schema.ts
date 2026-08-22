import { Static, Type } from '@sinclair/typebox';

export const scheduleOfficialTemplateVariableComponentSchema = Type.Union([
  Type.Literal('HEADER'),
  Type.Literal('BODY'),
  Type.Literal('FOOTER'),
  Type.Literal('BUTTON'),
]);

export const scheduleOfficialTemplateVariableValueSchema = Type.Object({
  key: Type.String(),
  component_type: scheduleOfficialTemplateVariableComponentSchema,
  index: Type.Number(),
  parameter_name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  button_index: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  value: Type.Union([Type.String(), Type.Number()]),
});

export const scheduleOfficialTemplateMessageSchema = Type.Object(
  {
    name: Type.String(),
    language: Type.String(),
    category: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    status: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    parameter_format: Type.Optional(
      Type.Union([Type.Literal('POSITIONAL'), Type.Literal('NAMED')])
    ),
    components: Type.Optional(Type.Array(Type.Any())),
    variables: Type.Optional(
      Type.Array(scheduleOfficialTemplateVariableValueSchema)
    ),
    preview: Type.Optional(Type.Any()),
  },
  { additionalProperties: true }
);

export const scheduleOfficialTemplateFieldSchema = Type.Optional(
  Type.Union([
    scheduleOfficialTemplateMessageSchema,
    Type.String(),
    Type.Null(),
    Type.Object({
      value: Type.Union([
        scheduleOfficialTemplateMessageSchema,
        Type.String(),
        Type.Null(),
      ]),
    }),
  ])
);

export type ScheduleOfficialTemplateMessage = Static<
  typeof scheduleOfficialTemplateMessageSchema
>;
