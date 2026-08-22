import { Static, Type } from '@sinclair/typebox';
import { officialWindowSchema } from '@core/schema/chat/officialWindow.schema';

const officialTemplateVariableComponentSchema = Type.Union([
  Type.Literal('HEADER'),
  Type.Literal('BODY'),
  Type.Literal('FOOTER'),
  Type.Literal('BUTTON'),
]);

const officialTemplateVariableSchema = Type.Object({
  key: Type.String(),
  component_type: officialTemplateVariableComponentSchema,
  index: Type.Number(),
  parameter_name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  button_index: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  sample: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

const officialTemplateButtonSchema = Type.Object({
  type: Type.String(),
  text: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  url: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  phone_number: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  example: Type.Optional(Type.Union([Type.Array(Type.String()), Type.Null()])),
  variables: Type.Optional(Type.Array(officialTemplateVariableSchema)),
});

const officialTemplateComponentSchema = Type.Object(
  {
    type: Type.String(),
    format: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    text: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    example: Type.Optional(
      Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()])
    ),
    buttons: Type.Optional(
      Type.Union([Type.Array(officialTemplateButtonSchema), Type.Null()])
    ),
    variables: Type.Optional(Type.Array(officialTemplateVariableSchema)),
  },
  { additionalProperties: true }
);

const officialTemplatePreviewSchema = Type.Object({
  header: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  body: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  footer: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  buttons: Type.Optional(Type.Array(Type.String())),
});

export const officialTemplateSchema = Type.Object({
  id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  name: Type.String(),
  language: Type.String(),
  status: Type.Literal('APPROVED'),
  parameter_format: Type.Optional(
    Type.Union([Type.Literal('POSITIONAL'), Type.Literal('NAMED')])
  ),
  category: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  components: Type.Array(officialTemplateComponentSchema),
  variables: Type.Array(officialTemplateVariableSchema),
  preview: officialTemplatePreviewSchema,
});

export const officialOpeningContextResponseSchema = Type.Object({
  worker_id: Type.String(),
  is_official: Type.Boolean(),
  requires_template: Type.Boolean(),
  official_window: officialWindowSchema,
  templates: Type.Array(officialTemplateSchema),
});

export type OfficialOpeningTemplate = Static<typeof officialTemplateSchema>;
export type OfficialOpeningContextResponse = Static<
  typeof officialOpeningContextResponseSchema
>;
