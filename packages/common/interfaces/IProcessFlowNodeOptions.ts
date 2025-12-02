export interface IProcessFlowNodeOptions {
  inactivityAlert?: {
    status?: string;
    quantity?: number;
    time?: number;
    action?: string;
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
  };
}
