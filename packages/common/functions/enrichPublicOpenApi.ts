type JsonObject = Record<string, unknown>;

const FIELD_DESCRIPTIONS: Record<string, string> = {
  account_id: 'Identificador único da conta Underchat.',
  account_name: 'Nome da conta Underchat à qual o usuário pertence.',
  actor_user_id:
    'Identificador do usuário que criou o token, mantido apenas para auditoria.',
  address1: 'Endereço principal do usuário.',
  address1_partial: 'Trecho mascarado do endereço principal.',
  address2: 'Complemento do endereço do usuário.',
  address2_partial: 'Trecho mascarado do complemento do endereço.',
  birth_date: 'Data de nascimento do usuário.',
  channel_id: 'Identificador único do canal associado ao usuário.',
  channel_ids: 'Canais aos quais o registro está associado.',
  channels: 'Canais vinculados ao usuário dentro da conta.',
  chat_id: 'Identificador único do atendimento.',
  city: 'Cidade do endereço do usuário.',
  city_fiscal_code: 'Código fiscal oficial da cidade.',
  contact_id: 'Identificador único do contato.',
  country_id: 'Identificador do país do endereço.',
  current_page: 'Página atual da consulta paginada.',
  data: 'Conteúdo retornado pela operação.',
  district: 'Bairro ou distrito do endereço.',
  document: 'Documento completo do usuário.',
  document_partial: 'Trecho mascarado do documento do usuário.',
  document_type_id: 'Identificador do tipo de documento.',
  email: 'Endereço de email usado pelo usuário.',
  email_partial: 'Email parcialmente mascarado para exibição segura.',
  enabled: 'Indica se a regra ou configuração está habilitada.',
  end_time: 'Horário de término da janela de atendimento.',
  first_name: 'Primeiro nome do usuário.',
  id: 'Identificador de rastreio da requisição.',
  keyapi: 'Credencial usada para autenticar a requisição.',
  label_template_id: 'Identificador único da etiqueta.',
  last_name: 'Sobrenome do usuário.',
  message: 'Mensagem que descreve o resultado da operação.',
  message_id: 'Identificador único da mensagem.',
  name: 'Nome legível do registro.',
  password: 'Senha inicial ou nova senha do usuário.',
  per_page: 'Quantidade de registros por página.',
  permission_role_id: 'Identificador do grupo de acesso do usuário.',
  phone: 'Número de telefone do usuário sem o código internacional.',
  phone_ddi: 'Código internacional do telefone.',
  phone_partial: 'Telefone parcialmente mascarado para exibição segura.',
  photo: 'Arquivo da foto de perfil enviado em multipart.',
  photo_url: 'URL atual da foto de perfil.',
  search: 'Texto usado para filtrar os resultados.',
  sector_id: 'Identificador único do setor.',
  sector_ids: 'Setores da conta que serão vinculados ao usuário.',
  sectors: 'Setores vinculados ao usuário dentro da conta.',
  sort_by: 'Critérios usados para ordenar os resultados.',
  start_time: 'Horário de início da janela de atendimento.',
  state: 'Estado ou unidade federativa do endereço.',
  state_fiscal_code: 'Código fiscal oficial do estado.',
  status: 'Indica o estado ou resultado da operação.',
  timezone: 'Fuso horário usado nas regras de atendimento.',
  user_id: 'Identificador único do usuário.',
  user_status_id: 'Identificador do status atual do usuário.',
  value: 'Valor efetivo do campo enviado pelo formulário.',
  'x-underchat-user-id':
    'Identificador do usuário executor desta chamada. Deve ser um usuário ativo da conta autenticada por keyapi.',
  worker_id: 'Identificador único do canal de atendimento.',
  zip_code: 'CEP ou código postal do endereço.',
};

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function humanizeField(name: string): string {
  const normalized = name.replaceAll('_', ' ').replaceAll('-', ' ');
  return `Valor do campo ${normalized}.`;
}

function exampleForSchema(schema: JsonObject): unknown {
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum[0];
  }
  if ('const' in schema) return schema.const;
  if ('default' in schema) return schema.default;

  if (Array.isArray(schema.anyOf) || Array.isArray(schema.oneOf)) {
    const variants = (schema.anyOf ?? schema.oneOf) as unknown[];
    for (const variant of variants) {
      if (!isObject(variant)) continue;
      const example = exampleForSchema(variant);
      if (example !== undefined) return example;
    }
  }

  if (schema.type === 'string') {
    if (schema.format === 'uuid') return '00000000-0000-4000-8000-000000000000';
    if (schema.format === 'date-time') return '2026-07-10T12:00:00.000Z';
    if (schema.format === 'date') return '2026-07-10';
    if (schema.format === 'email') return 'contato@exemplo.com';
    if (schema.format === 'uri' || schema.format === 'url') {
      return 'https://exemplo.com/recurso';
    }
    return 'exemplo';
  }
  if (schema.type === 'integer' || schema.type === 'number') return 1;
  if (schema.type === 'boolean') return true;
  if (schema.type === 'null') return null;
  if (schema.type === 'array') return [];
  if (schema.type === 'object' && isObject(schema.properties)) {
    return Object.fromEntries(
      Object.entries(schema.properties).flatMap(([name, property]) => {
        if (!isObject(property)) return [];
        const example = exampleForSchema(property);
        return example === undefined ? [] : [[name, example]];
      })
    );
  }

  return undefined;
}

function enrichContent(content: unknown): void {
  if (!isObject(content)) return;

  for (const mediaType of Object.values(content)) {
    if (!isObject(mediaType)) continue;
    enrichSchema(mediaType.schema);
  }
}

function enrichHeaders(headers: unknown): void {
  if (!isObject(headers)) return;

  for (const [name, header] of Object.entries(headers)) {
    if (!isObject(header)) continue;
    header.description ??= FIELD_DESCRIPTIONS[name] ?? humanizeField(name);
    enrichSchema(header.schema, name);
  }
}

function enrichSchema(schema: unknown, fieldName?: string): void {
  if (Array.isArray(schema)) {
    schema.forEach((entry) => enrichSchema(entry, fieldName));
    return;
  }
  if (!isObject(schema)) return;

  if (fieldName) {
    schema.description ??=
      FIELD_DESCRIPTIONS[fieldName] ?? humanizeField(fieldName);
    if (!('example' in schema) && !('examples' in schema)) {
      const example = exampleForSchema(schema);
      schema.example = example ?? null;
    }
  }

  if (isObject(schema.properties)) {
    for (const [name, property] of Object.entries(schema.properties)) {
      enrichSchema(property, name);
    }
  }

  for (const key of [
    'items',
    'additionalProperties',
    'anyOf',
    'oneOf',
    'allOf',
    'not',
  ]) {
    enrichSchema(schema[key], fieldName);
  }

  enrichSchema(schema.schema, fieldName);
  enrichContent(schema.content);
}

function enrichOperation(operation: JsonObject): void {
  operation.description ??= operation.summary ?? 'Operação da API pública.';
  operation.summary ??= operation.description;

  if (Array.isArray(operation.parameters)) {
    for (const parameter of operation.parameters) {
      if (!isObject(parameter)) continue;
      const name =
        typeof parameter.name === 'string' ? parameter.name : 'valor';
      parameter.description ??= FIELD_DESCRIPTIONS[name] ?? humanizeField(name);
      enrichSchema(parameter.schema, name);
    }
  }

  const requestBody = operation.requestBody;
  if (isObject(requestBody)) {
    requestBody.description ??= 'Dados enviados para executar a operação.';
    enrichContent(requestBody.content);
  }

  const responses = operation.responses;
  if (isObject(responses)) {
    for (const [status, response] of Object.entries(responses)) {
      if (!isObject(response)) continue;
      response.description ??= `Resposta HTTP ${status}.`;
      enrichContent(response.content);
      enrichHeaders(response.headers);
    }
  }
}

/**
 * Complements the OpenAPI document generated from the shared TypeBox schemas.
 * It does not define contracts a second time; it only fills documentation
 * metadata that is absent from legacy schemas.
 */
export function enrichPublicOpenApi<T>(source: T): T {
  const document = structuredClone(source) as T;
  if (!isObject(document)) return document;

  enrichSchema(document.components);

  if (isObject(document.paths)) {
    for (const pathItem of Object.values(document.paths)) {
      if (!isObject(pathItem)) continue;
      for (const [method, operation] of Object.entries(pathItem)) {
        if (!['get', 'post', 'put', 'patch', 'delete'].includes(method))
          continue;
        if (isObject(operation)) enrichOperation(operation);
      }
    }
  }

  return document;
}
