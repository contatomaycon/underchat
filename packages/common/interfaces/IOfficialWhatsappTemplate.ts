export type OfficialTemplateVariableComponent =
  'HEADER' | 'BODY' | 'FOOTER' | 'BUTTON';

export type OfficialTemplateParameterFormat = 'POSITIONAL' | 'NAMED';

export interface IOfficialTemplateVariable {
  key: string;
  component_type: OfficialTemplateVariableComponent;
  index: number;
  parameter_name?: string | null;
  button_index?: number | null;
  sample?: string | null;
}

export interface IOfficialTemplateButton {
  type: string;
  text?: string | null;
  url?: string | null;
  phone_number?: string | null;
  example?: string[] | null;
  variables?: IOfficialTemplateVariable[];
}

export interface IOfficialTemplateComponent {
  type: string;
  format?: string | null;
  text?: string | null;
  example?: Record<string, unknown> | null;
  buttons?: IOfficialTemplateButton[] | null;
  variables?: IOfficialTemplateVariable[];
}

export interface IOfficialTemplateVariableValue {
  key: string;
  component_type: OfficialTemplateVariableComponent;
  index: number;
  parameter_name?: string | null;
  button_index?: number | null;
  value: string | number;
}

export interface IOfficialWhatsappTemplate {
  id?: string | null;
  name: string;
  language: string;
  status: 'APPROVED';
  parameter_format?: OfficialTemplateParameterFormat;
  category?: string | null;
  components: IOfficialTemplateComponent[];
  variables: IOfficialTemplateVariable[];
  preview: {
    header?: string | null;
    body?: string | null;
    footer?: string | null;
    buttons?: string[];
  };
}

export interface IOfficialWhatsappTemplateMessage {
  name: string;
  language: string;
  category?: string | null;
  status?: 'APPROVED' | string | null;
  parameter_format?: OfficialTemplateParameterFormat;
  components?: IOfficialTemplateComponent[];
  variables?: IOfficialTemplateVariableValue[];
  preview?: IOfficialWhatsappTemplate['preview'];
}
