export type ActiveWhatsappValidationContext = 'register' | 'forgot_password';

export interface IActiveWhatsappValidationResponse {
  validation_id: string;
  validation_text: string;
  whatsapp_url: string;
  target_phone: string;
  centrifugo_url: string;
  centrifugo_token: string;
  centrifugo_channel: string;
}

export interface IActiveWhatsappValidationPublication {
  status: 'validated' | 'rejected';
  context: ActiveWhatsappValidationContext;
  token?: string;
  reason?: string;
}
