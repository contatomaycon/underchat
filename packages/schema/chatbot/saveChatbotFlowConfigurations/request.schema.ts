import { Static, Type } from '@sinclair/typebox';

const triggerEventsSchema = Type.Array(
  Type.Union([
    Type.Literal('text'),
    Type.Literal('audio'),
    Type.Literal('attachments'),
    Type.Literal('reactions'),
    Type.Literal('gifs'),
  ])
);

const inactivityAlertTargetProperties = {
  action: Type.Optional(
    Type.Union([Type.Literal('finish'), Type.Literal('redirect')])
  ),
  redirect_type: Type.Optional(
    Type.Union([
      Type.Literal('user'),
      Type.Literal('sector'),
      Type.Literal('chatbot'),
    ])
  ),
  selected_user: Type.Optional(Type.String()),
  selected_sector: Type.Optional(Type.String()),
  selected_sector_user: Type.Optional(Type.String()),
  selected_channel: Type.Optional(Type.String({ format: 'uuid' })),
  selected_chatbot: Type.Optional(Type.String({ format: 'uuid' })),
};

const inactivityAlertSchema = Type.Union([
  Type.Object({
    status: Type.Literal('active'),
    quantity: Type.Integer({ minimum: 1 }),
    time: Type.Integer({ minimum: 1 }),
    ...inactivityAlertTargetProperties,
  }),
  Type.Object({
    status: Type.Literal('inactive'),
    quantity: Type.Optional(Type.Integer({ minimum: 1 })),
    time: Type.Optional(Type.Integer({ minimum: 1 })),
    ...inactivityAlertTargetProperties,
  }),
]);

const configurationsSchema = Type.Object({
  inactivity_alert: Type.Optional(inactivityAlertSchema),
  redirect_failed_attempts: Type.Optional(
    Type.Object({
      status: Type.Union([Type.Literal('active'), Type.Literal('inactive')]),
      quantity: Type.Optional(Type.Integer({ minimum: 1 })),
      redirect_type: Type.Optional(
        Type.Union([Type.Literal('user'), Type.Literal('sector')])
      ),
      selected_user: Type.Optional(Type.String()),
      selected_sector: Type.Optional(Type.String()),
      selected_sector_user: Type.Optional(Type.String()),
    })
  ),
  finish_triggers: Type.Optional(Type.Array(Type.String())),
  trigger_events: Type.Optional(triggerEventsSchema),
  messages: Type.Optional(
    Type.Object({
      inactivity_message: Type.Optional(Type.String()),
      invalid_menu_option_message: Type.Optional(Type.String()),
      invalid_satisfaction_option_message: Type.Optional(Type.String()),
      invalid_cpf_message: Type.Optional(Type.String()),
      invalid_cnpj_message: Type.Optional(Type.String()),
      invalid_email_message: Type.Optional(Type.String()),
      service_finished_message: Type.Optional(Type.String()),
      transfer_message_user: Type.Optional(Type.String()),
      transfer_message_sector: Type.Optional(Type.String()),
      transfer_message_sector_user: Type.Optional(Type.String()),
      inactivity_message_enabled: Type.Optional(Type.Boolean()),
      invalid_menu_option_message_enabled: Type.Optional(Type.Boolean()),
      invalid_satisfaction_option_message_enabled: Type.Optional(
        Type.Boolean()
      ),
      invalid_cpf_message_enabled: Type.Optional(Type.Boolean()),
      invalid_cnpj_message_enabled: Type.Optional(Type.Boolean()),
      invalid_email_message_enabled: Type.Optional(Type.Boolean()),
      service_finished_message_enabled: Type.Optional(Type.Boolean()),
      transfer_message_user_enabled: Type.Optional(Type.Boolean()),
      transfer_message_sector_enabled: Type.Optional(Type.Boolean()),
      transfer_message_sector_user_enabled: Type.Optional(Type.Boolean()),
    })
  ),
});

export const saveChatbotFlowConfigurationsRequestSchema = Type.Object({
  chatbot_id: Type.String(),
  configurations: configurationsSchema,
});

export type SaveChatbotFlowConfigurationsRequest = Static<
  typeof saveChatbotFlowConfigurationsRequestSchema
>;
