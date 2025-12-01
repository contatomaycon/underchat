import { Static, Type } from '@sinclair/typebox';

const configurationsSchema = Type.Object({
  inactivity_alert: Type.Optional(
    Type.Object({
      status: Type.String(),
      quantity: Type.Optional(Type.Number()),
      time: Type.Optional(Type.Number()),
      action: Type.Optional(Type.String()),
      redirect_type: Type.Optional(Type.String()),
      selected_user: Type.Optional(Type.String()),
      selected_sector: Type.Optional(Type.String()),
      selected_sector_user: Type.Optional(Type.String()),
    })
  ),
  redirect_failed_attempts: Type.Optional(
    Type.Object({
      status: Type.String(),
      quantity: Type.Optional(Type.Number()),
      redirect_type: Type.Optional(Type.String()),
      selected_user: Type.Optional(Type.String()),
      selected_sector: Type.Optional(Type.String()),
      selected_sector_user: Type.Optional(Type.String()),
    })
  ),
  messages: Type.Optional(
    Type.Object({
      inactivity_message: Type.Optional(Type.String()),
      invalid_menu_option_message: Type.Optional(Type.String()),
      invalid_satisfaction_option_message: Type.Optional(Type.String()),
      invalid_cpf_message: Type.Optional(Type.String()),
      invalid_cnpj_message: Type.Optional(Type.String()),
      invalid_email_message: Type.Optional(Type.String()),
      service_finished_message: Type.Optional(Type.String()),
    })
  ),
});

export const listChatbotFlowConfigurationsResponseSchema = Type.Object({
  chatbot_configurations_id: Type.String(),
  chatbot_id: Type.String(),
  account_id: Type.String(),
  configurations: configurationsSchema,
  created_at: Type.Optional(Type.String()),
  updated_at: Type.Optional(Type.String()),
});

export type ListChatbotFlowConfigurationsResponse = Static<
  typeof listChatbotFlowConfigurationsResponseSchema
>;
