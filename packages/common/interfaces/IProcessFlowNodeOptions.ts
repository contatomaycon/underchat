export interface IProcessFlowNodeOptions {
  inactivityAlert?: {
    status?: string;
    quantity?: number;
    time?: number;
    action?: string;
    redirect_type?: 'user' | 'sector' | 'chatbot';
    selected_user?: string;
    selected_sector?: string;
    selected_sector_user?: string;
    selected_channel?: string;
    selected_chatbot?: string;
  };
  redirectFailedAttempts?: {
    status?: string;
    quantity?: number;
    redirect_type?: string;
    selected_user?: string;
    selected_sector?: string;
    selected_sector_user?: string;
  };
  customMessages?: {
    inactivity_message?: string;
    invalid_menu_option_message?: string;
    invalid_satisfaction_option_message?: string;
    invalid_cpf_message?: string;
    invalid_cnpj_message?: string;
    invalid_email_message?: string;
    service_finished_message?: string;
    transfer_message_user?: string;
    transfer_message_sector?: string;
    transfer_message_sector_user?: string;
    inactivity_message_enabled?: boolean;
    invalid_menu_option_message_enabled?: boolean;
    invalid_satisfaction_option_message_enabled?: boolean;
    invalid_cpf_message_enabled?: boolean;
    invalid_cnpj_message_enabled?: boolean;
    invalid_email_message_enabled?: boolean;
    service_finished_message_enabled?: boolean;
    transfer_message_user_enabled?: boolean;
    transfer_message_sector_enabled?: boolean;
    transfer_message_sector_user_enabled?: boolean;
  };
}
