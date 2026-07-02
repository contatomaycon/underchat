import type {
  IOfficialWhatsappDisplayAction,
  IOfficialWhatsappDisplayCard,
  IOfficialWhatsappDisplayMedia,
  IOfficialWhatsappDisplayMetadata,
  IOfficialWhatsappDisplaySection,
  OfficialWhatsappDisplayKind,
} from '@core/common/interfaces/IOfficialWhatsappContentMetadata';
import type {
  IOfficialWhatsappTemplateMessage,
  OfficialTemplateVariableComponent,
} from '@core/common/interfaces/IOfficialWhatsappTemplate';

type MetaRecord = Record<string, unknown>;

const interactiveKindByType: Record<string, OfficialWhatsappDisplayKind> = {
  button: 'button',
  list: 'list',
  cta_url: 'cta_url',
  location_request_message: 'location_request',
  flow: 'flow',
  product: 'product',
  product_list: 'product_list',
  catalog_message: 'catalog',
  carousel: 'carousel',
  address_message: 'address',
  call_permission_request: 'call_permission_request',
};

const toRecord = (value: unknown): MetaRecord | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as MetaRecord;
};

const toRecordArray = (value: unknown): MetaRecord[] =>
  Array.isArray(value)
    ? value.filter(
        (item): item is MetaRecord =>
          Boolean(item) && typeof item === 'object' && !Array.isArray(item)
      )
    : [];

const toNonEmptyString = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return null;
};

const firstText = (...values: unknown[]): string | null => {
  for (const value of values) {
    const text = toNonEmptyString(value);
    if (text) return text;
  }

  return null;
};

const parseJsonObject = (value: unknown): Record<string, unknown> | null => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return toRecord(parsed);
  } catch {
    return null;
  }
};

const resolveHeaderText = (header: MetaRecord | null): string | null => {
  if (!header) return null;

  return firstText(
    header.text,
    toRecord(header.image)?.caption,
    toRecord(header.video)?.caption,
    toRecord(header.document)?.filename
  );
};

const resolveBodyText = (
  interactive: MetaRecord,
  fallback?: string | null
): string | null =>
  firstText(
    toRecord(interactive.body)?.text,
    interactive.body,
    toRecord(interactive.text)?.body,
    interactive.text,
    fallback
  );

const resolveFooterText = (interactive: MetaRecord): string | null =>
  firstText(toRecord(interactive.footer)?.text, interactive.footer);

const resolveInteractiveKind = (
  rawType: string | null
): OfficialWhatsappDisplayKind =>
  rawType ? (interactiveKindByType[rawType] ?? 'reply') : 'reply';

const normalizeReplyAction = (
  value: MetaRecord,
  fallbackType?: string | null
): IOfficialWhatsappDisplayAction | null => {
  const reply = toRecord(value.reply) ?? value;
  const title = firstText(reply.title, reply.name, reply.text);
  const id = firstText(reply.id, reply.payload, reply.product_retailer_id);
  const description = firstText(
    reply.description,
    reply.body,
    reply.quantity ? `Qtd: ${String(reply.quantity)}` : null
  );

  if (!title && !id && !description) {
    return null;
  }

  return {
    id,
    type: firstText(value.type, reply.type, fallbackType),
    title: title ?? id,
    description,
    url: firstText(reply.url, reply.link),
    phone_number: firstText(reply.phone_number),
  };
};

const normalizeButtonActions = (
  buttons: unknown,
  fallbackType: string | null
): IOfficialWhatsappDisplayAction[] =>
  toRecordArray(buttons)
    .map((button) => normalizeReplyAction(button, fallbackType))
    .filter((button): button is IOfficialWhatsappDisplayAction =>
      Boolean(button)
    );

const normalizeRowActions = (
  rows: unknown,
  fallbackType: string | null
): IOfficialWhatsappDisplayAction[] =>
  toRecordArray(rows)
    .map((row) => normalizeReplyAction(row, fallbackType))
    .filter((row): row is IOfficialWhatsappDisplayAction => Boolean(row));

const normalizeSections = (
  sections: unknown,
  fallbackType: string | null
): IOfficialWhatsappDisplaySection[] =>
  toRecordArray(sections)
    .map((section, index): IOfficialWhatsappDisplaySection | null => {
      const rows = normalizeRowActions(
        section.rows ?? section.product_items ?? section.items,
        fallbackType
      );

      if (rows.length === 0) {
        return null;
      }

      return {
        id: firstText(section.id, `section-${index + 1}`),
        title: firstText(section.title),
        rows,
        items: section.product_items ? rows : undefined,
      };
    })
    .filter((section): section is IOfficialWhatsappDisplaySection =>
      Boolean(section)
    );

const normalizeProductItems = (
  items: unknown
): IOfficialWhatsappDisplayAction[] =>
  toRecordArray(items)
    .map((item): IOfficialWhatsappDisplayAction | null => {
      const id = firstText(item.product_retailer_id, item.id);
      if (!id) return null;

      return {
        id,
        type: 'product',
        title: firstText(item.title, item.name, id),
        description: firstText(
          item.description,
          item.quantity ? `Qtd: ${String(item.quantity)}` : null,
          item.currency && item.item_price
            ? `${String(item.currency)} ${String(item.item_price)}`
            : null
        ),
      };
    })
    .filter((item): item is IOfficialWhatsappDisplayAction => Boolean(item));

const resolveMediaFromParameter = (
  parameter: MetaRecord
): IOfficialWhatsappDisplayMedia | null => {
  const type = firstText(parameter.type);
  const media =
    toRecord(parameter.image) ??
    toRecord(parameter.video) ??
    toRecord(parameter.document);

  if (!type && !media) return null;

  return {
    type,
    id: firstText(media?.id, parameter.id),
    url: firstText(media?.url, media?.link, parameter.url),
    link: firstText(media?.link),
    caption: firstText(media?.caption, media?.filename),
  };
};

const normalizeCarouselCards = (
  cards: unknown
): IOfficialWhatsappDisplayCard[] =>
  toRecordArray(cards)
    .map((card, index): IOfficialWhatsappDisplayCard | null => {
      const components = toRecordArray(card.components);
      let media: IOfficialWhatsappDisplayMedia | null = null;
      let body: string | null = firstText(card.body, card.text);
      let title: string | null = firstText(card.title, `Card ${index + 1}`);
      let footer: string | null = firstText(card.footer);
      const actions: IOfficialWhatsappDisplayAction[] = [];

      for (const component of components) {
        const componentType = firstText(component.type)?.toLowerCase();
        const parameters = toRecordArray(component.parameters);

        if (componentType === 'header') {
          media =
            parameters
              .map(resolveMediaFromParameter)
              .find((item): item is IOfficialWhatsappDisplayMedia =>
                Boolean(item)
              ) ?? null;
          title = firstText(component.text, media?.caption, title);
        }

        if (componentType === 'body') {
          body = firstText(
            component.text,
            parameters.map((parameter) => firstText(parameter.text)).join(' '),
            body
          );
        }

        if (componentType === 'footer') {
          footer = firstText(component.text, footer);
        }

        if (componentType === 'button') {
          const parameterText = parameters
            .map((parameter) => firstText(parameter.text, parameter.payload))
            .find(Boolean);
          actions.push({
            id: firstText(component.index),
            type: firstText(component.sub_type, component.type, 'button'),
            title: firstText(component.text, parameterText, 'Abrir'),
            url: firstText(component.url, parameterText),
          });
        }
      }

      const normalizedActions = [
        ...actions,
        ...normalizeButtonActions(card.buttons, 'button'),
      ];

      if (!title && !body && !media && normalizedActions.length === 0) {
        return null;
      }

      return {
        title,
        body,
        footer,
        media,
        actions: normalizedActions,
      };
    })
    .filter((card): card is IOfficialWhatsappDisplayCard => Boolean(card));

const normalizeCtaAction = (
  action: MetaRecord | null,
  fallbackLabel?: string | null
): IOfficialWhatsappDisplayAction[] => {
  const parameters = toRecord(action?.parameters);
  const title = firstText(
    parameters?.display_text,
    parameters?.flow_cta,
    action?.button,
    fallbackLabel,
    'Abrir'
  );
  const url = firstText(parameters?.url, action?.url);
  const id = firstText(parameters?.flow_id, parameters?.flow_name);

  return [
    {
      id,
      type: firstText(action?.name, 'button'),
      title,
      url,
      phone_number: firstText(parameters?.phone_number),
    },
  ];
};

export const buildOfficialWhatsappDisplayFromInteractive = (
  interactive: Record<string, unknown> | null | undefined,
  explicitType?: string | null,
  fallbackText?: string | null
): IOfficialWhatsappDisplayMetadata | null => {
  const payload = toRecord(interactive);
  if (!payload) return null;

  const rawType = firstText(explicitType, payload.type);
  const kind = resolveInteractiveKind(rawType);
  const action = toRecord(payload.action);
  const header = toRecord(payload.header);
  const common = {
    kind,
    raw_type: rawType,
    title: resolveHeaderText(header),
    body: resolveBodyText(payload, fallbackText),
    footer: resolveFooterText(payload),
  };

  if (kind === 'button') {
    return {
      ...common,
      actions: normalizeButtonActions(action?.buttons, rawType),
    };
  }

  if (kind === 'list') {
    return {
      ...common,
      action_label: firstText(action?.button, 'Selecionar'),
      sections: normalizeSections(action?.sections, rawType),
    };
  }

  if (kind === 'cta_url') {
    return {
      ...common,
      action_label: firstText(toRecord(action?.parameters)?.display_text),
      actions: normalizeCtaAction(action, 'Abrir link'),
    };
  }

  if (kind === 'location_request') {
    return {
      ...common,
      action_label: 'Enviar localização',
      actions: [{ type: 'location_request', title: 'Enviar localização' }],
    };
  }

  if (kind === 'flow') {
    const parameters = toRecord(action?.parameters);
    return {
      ...common,
      action_label: firstText(parameters?.flow_cta, 'Abrir'),
      actions: normalizeCtaAction(action, 'Abrir'),
      submitted_data: parseJsonObject(parameters?.flow_action_payload),
    };
  }

  if (kind === 'product') {
    return {
      ...common,
      items: [
        {
          id: firstText(action?.product_retailer_id),
          type: 'product',
          title: firstText(action?.product_retailer_id, 'Produto'),
          description: firstText(action?.catalog_id),
        },
      ].filter((item) => item.id || item.title),
    };
  }

  if (kind === 'product_list') {
    return {
      ...common,
      action_label: 'Ver produtos',
      sections: normalizeSections(action?.sections, rawType),
    };
  }

  if (kind === 'catalog') {
    return {
      ...common,
      action_label: 'Abrir catálogo',
      actions: normalizeCtaAction(action, 'Abrir catálogo'),
      submitted_data: parseJsonObject(toRecord(action?.parameters)),
    };
  }

  if (kind === 'carousel') {
    return {
      ...common,
      action_label: 'Ver opções',
      cards: normalizeCarouselCards(action?.cards),
    };
  }

  if (kind === 'address') {
    return {
      ...common,
      action_label: 'Enviar endereço',
      actions: [{ type: 'address', title: 'Enviar endereço' }],
      submitted_data: parseJsonObject(toRecord(action?.parameters)),
    };
  }

  if (kind === 'call_permission_request') {
    return {
      ...common,
      action_label: 'Permitir ligação',
      actions: [{ type: 'call_permission_request', title: 'Permitir ligação' }],
    };
  }

  return common;
};

const buildReplyDisplay = (
  rawType: string | null,
  reply: MetaRecord | null
): IOfficialWhatsappDisplayMetadata => {
  const submittedData = parseJsonObject(reply?.response_json);
  const title = firstText(reply?.title, reply?.name, reply?.text);

  return {
    kind: 'reply',
    raw_type: rawType,
    title: title ?? firstText(reply?.id, 'Resposta'),
    body: firstText(reply?.description, reply?.body, reply?.response_json),
    actions: [
      {
        id: firstText(reply?.id),
        type: rawType,
        title,
        description: firstText(reply?.description, reply?.body),
      },
    ],
    submitted_data: submittedData,
  };
};

const buildReferralDisplay = (
  referral: MetaRecord | null
): IOfficialWhatsappDisplayMetadata | null => {
  if (!referral) return null;

  return {
    kind: 'referral',
    raw_type: firstText(referral.source_type),
    title: firstText(referral.headline, referral.source_type, 'Referral'),
    body: firstText(referral.body, referral.source_url),
    media: {
      type: firstText(referral.media_type),
      url: firstText(
        referral.image_url,
        referral.video_url,
        referral.thumbnail_url
      ),
      caption: firstText(referral.headline),
    },
    actions: [
      {
        type: 'url',
        title: firstText(referral.source_type, 'Abrir origem'),
        url: firstText(referral.source_url),
      },
    ].filter((action) => action.url || action.title),
  };
};

export const buildOfficialWhatsappDisplayFromMetaMessage = (
  message: Record<string, unknown> | null | undefined,
  metaType: string | null | undefined
): IOfficialWhatsappDisplayMetadata | null => {
  const payload = toRecord(message);
  const rawType = firstText(metaType, payload?.type);
  if (!payload || !rawType) return null;

  if (rawType === 'interactive') {
    const interactive = toRecord(payload.interactive);
    const interactiveType = firstText(interactive?.type);
    const reply =
      toRecord(interactive?.button_reply) ??
      toRecord(interactive?.list_reply) ??
      toRecord(interactive?.nfm_reply);

    if (reply) {
      return buildReplyDisplay(interactiveType, reply);
    }

    return buildOfficialWhatsappDisplayFromInteractive(
      interactive,
      interactiveType
    );
  }

  if (rawType === 'button') {
    const button = toRecord(payload.button);
    return buildReplyDisplay('button', {
      id: firstText(button?.payload),
      title: firstText(button?.text),
      description: firstText(button?.payload),
    });
  }

  if (rawType === 'order') {
    const order = toRecord(payload.order);
    const items = normalizeProductItems(order?.product_items);
    return {
      kind: 'order',
      raw_type: rawType,
      title: 'Pedido',
      body: firstText(order?.text, order?.catalog_id),
      items,
      action_label: items.length > 0 ? `${items.length} produto(s)` : null,
    };
  }

  if (rawType === 'system') {
    const system = toRecord(payload.system);
    return {
      kind: 'system',
      raw_type: rawType,
      title: 'Sistema',
      body: firstText(system?.body, payload.message),
    };
  }

  if (rawType === 'unsupported') {
    const unsupported = toRecord(payload.unsupported);
    return {
      kind: 'unsupported',
      raw_type: firstText(unsupported?.type, rawType),
      title: 'Mensagem não suportada',
      body: firstText(
        unsupported?.reason,
        'A Meta não entregou conteúdo renderizável para esta mensagem.'
      ),
    };
  }

  const referral = buildReferralDisplay(
    toRecord(toRecord(payload.context)?.referral)
  );
  return referral;
};

const findTemplateComponentText = (
  template: IOfficialWhatsappTemplateMessage,
  componentType: string
): string | null => {
  const component = template.components?.find(
    (item) => item.type?.toUpperCase() === componentType
  );

  return firstText(component?.text);
};

const buildTemplateVariableKey = (
  componentType: OfficialTemplateVariableComponent,
  index: number,
  buttonIndex?: number | null
): string =>
  componentType === 'BUTTON'
    ? `${componentType}:${buttonIndex ?? 0}:${index}`
    : `${componentType}:${index}`;

const buildTemplateVariableValueMap = (
  template: IOfficialWhatsappTemplateMessage
): Map<string, string> => {
  const valueMap = new Map<string, string>();

  for (const variable of template.variables ?? []) {
    const value = variable.value?.trim();
    if (!value) {
      continue;
    }

    valueMap.set(variable.key, value);
    valueMap.set(
      buildTemplateVariableKey(
        variable.component_type,
        variable.index,
        variable.button_index ?? null
      ),
      value
    );
  }

  return valueMap;
};

const fillTemplateText = (
  text: string | null,
  template: IOfficialWhatsappTemplateMessage,
  componentType: OfficialTemplateVariableComponent,
  buttonIndex?: number | null
): string | null => {
  if (!text) {
    return text;
  }

  const valueMap = buildTemplateVariableValueMap(template);

  return text.replace(/\{\{\s*(\d+)\s*\}\}/gu, (match, index: string) => {
    const key = buildTemplateVariableKey(
      componentType,
      Number(index),
      buttonIndex
    );
    return valueMap.get(key) ?? match;
  });
};

export const buildOfficialWhatsappDisplayFromTemplate = (
  template: IOfficialWhatsappTemplateMessage | null | undefined,
  fallbackText?: string | null
): IOfficialWhatsappDisplayMetadata | null => {
  if (!template?.name) return null;

  const buttonComponent = template.components?.find(
    (component) => component.type?.toUpperCase() === 'BUTTONS'
  );
  const componentButtons =
    buttonComponent?.buttons?.map((button, index) => ({
      id: String(index),
      type: firstText(button.type),
      title: fillTemplateText(
        firstText(button.text, button.type),
        template,
        'BUTTON',
        index
      ),
      url: fillTemplateText(firstText(button.url), template, 'BUTTON', index),
      phone_number: firstText(button.phone_number),
    })) ?? [];
  const previewButtons =
    template.preview?.buttons?.map((button, index) => ({
      id: String(index),
      type: 'button',
      title: fillTemplateText(button, template, 'BUTTON', index),
    })) ?? [];

  return {
    kind: 'template',
    raw_type: 'template',
    title: fillTemplateText(
      firstText(
        template.preview?.header,
        findTemplateComponentText(template, 'HEADER')
      ),
      template,
      'HEADER'
    ),
    body: fillTemplateText(
      firstText(
        template.preview?.body,
        findTemplateComponentText(template, 'BODY'),
        fallbackText
      ),
      template,
      'BODY'
    ),
    footer: fillTemplateText(
      firstText(
        template.preview?.footer,
        findTemplateComponentText(template, 'FOOTER')
      ),
      template,
      'FOOTER'
    ),
    actions: componentButtons.length > 0 ? componentButtons : previewButtons,
  };
};
