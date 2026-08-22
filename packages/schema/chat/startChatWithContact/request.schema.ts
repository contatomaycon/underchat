import { Static, Type } from '@sinclair/typebox';

const officialTemplateVariableComponentSchema = Type.Union([
  Type.Literal('HEADER'),
  Type.Literal('BODY'),
  Type.Literal('FOOTER'),
  Type.Literal('BUTTON'),
]);

const officialTemplateVariableValueSchema = Type.Object({
  key: Type.String(),
  component_type: officialTemplateVariableComponentSchema,
  index: Type.Number(),
  parameter_name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  button_index: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  value: Type.Union([Type.String(), Type.Number()]),
});

export const officialTemplateMessageRequestSchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  language: Type.String({ minLength: 1 }),
  variables: Type.Optional(Type.Array(officialTemplateVariableValueSchema)),
});

export const startChatWithContactRequestSchema = Type.Object({
  contact_id: Type.String({ format: 'uuid' }),
  worker_id: Type.String({ format: 'uuid' }),
  sector_id: Type.Optional(Type.String({ format: 'uuid' })),
  official_template: Type.Optional(officialTemplateMessageRequestSchema),
});

export type StartChatWithContactRequest = Static<
  typeof startChatWithContactRequestSchema
>;

export type OfficialTemplateMessageRequest = Static<
  typeof officialTemplateMessageRequestSchema
>;
