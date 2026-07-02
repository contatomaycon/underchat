<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { NodeProps } from '@vue-flow/core';
import { Handle, Position, useVueFlow } from '@vue-flow/core';
import {
  buildOfficialTemplateKey,
  buildOfficialTemplatePreview,
  createManualOfficialTemplateVariable,
  createOfficialTemplateOptions,
  createOfficialTemplateVariableValues,
  findOfficialTemplate,
  formatOfficialTemplateLanguage,
  refreshOfficialTemplateVariableKey,
} from '@/utils/officialTemplate';
import type {
  OfficialTemplate,
  OfficialTemplatePreview,
} from '@/utils/officialTemplate';

interface OfficialOption {
  id: string;
  text: string;
  description?: string | null;
}

interface OfficialProductItem {
  product_retailer_id: string;
}

interface OfficialProductSection {
  title: string;
  product_items: OfficialProductItem[];
}

interface OfficialCarouselCard {
  body: string;
  mediaType: 'image' | 'video';
  mediaUrl: string;
  mediaId: string;
  buttonText: string;
  buttonUrl: string;
}

interface OfficialTemplateVariable {
  key: string;
  component_type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTON';
  index: number;
  button_index?: number | null;
  value: string;
}

interface OfficialContactItem {
  contact_id: string | null;
  name: string;
  last_name?: string | null;
  phone?: string | null;
  phone_ddi?: string | null;
  email?: string | null;
}

interface OfficialNodeData {
  title?: string;
  message?: string;
  text?: string;
  header?: string;
  footer?: string;
  buttonText?: string;
  url?: string;
  flowId?: string;
  flowName?: string;
  flowToken?: string;
  flowAction?: string;
  sectionTitle?: string;
  catalogId?: string;
  productRetailerId?: string;
  latitude?: number | string | null;
  longitude?: number | string | null;
  name?: string;
  address?: string;
  addressCountry?: string;
  templateName?: string;
  templateLanguage?: string;
  templateCategory?: string | null;
  templateComponents?: OfficialTemplate['components'];
  templatePreview?:
    OfficialTemplatePreview | OfficialTemplate['preview'] | null;
  attachmentUrl?: string;
  attachmentMimetype?: string;
  emoji?: string;
  options?: OfficialOption[];
  products?: unknown[] | OfficialProductItem[];
  sections?: unknown[] | OfficialProductSection[];
  cards?: unknown[] | OfficialCarouselCard[];
  contacts?: unknown[] | OfficialContactItem[];
  templateVariables?: unknown[] | OfficialTemplateVariable[];
  parameters?: Record<string, unknown>;
  action?: Record<string, unknown>;
  availableOfficialTemplates?: OfficialTemplate[];
  isLoadingOfficialTemplates?: boolean;
  officialTemplatesError?: string | null;
  officialType?: string;
  official?: Record<string, unknown>;
  onRemove?: () => void;
  onRemoveOption?: (optionId: string) => void;
}

const props = defineProps<NodeProps>();
const { updateNodeInternals } = useVueFlow();
const { locale } = useI18n();

const nodeType = computed(() => props.type || '');

const OFFICIAL_NODE_META: Record<
  string,
  { label: string; icon: string; accent: string }
> = {
  officialReplyButtons: {
    label: 'Botões oficiais',
    icon: 'tabler-square-rounded-plus',
    accent: '#00a884',
  },
  officialList: {
    label: 'Lista oficial',
    icon: 'tabler-list',
    accent: '#00a884',
  },
  officialCtaUrl: {
    label: 'CTA URL',
    icon: 'tabler-external-link',
    accent: '#0284c7',
  },
  officialLocationRequest: {
    label: 'Solicitar localização',
    icon: 'tabler-current-location',
    accent: '#22c55e',
  },
  officialFlow: {
    label: 'Fluxo WhatsApp',
    icon: 'tabler-sitemap',
    accent: '#7c3aed',
  },
  officialSingleProduct: {
    label: 'Produto único',
    icon: 'tabler-package',
    accent: '#ca8a04',
  },
  officialMultiProduct: {
    label: 'Lista de produtos',
    icon: 'tabler-shopping-cart-plus',
    accent: '#ca8a04',
  },
  officialCatalog: {
    label: 'Catálogo',
    icon: 'tabler-shopping-cart',
    accent: '#0f766e',
  },
  officialMediaCarousel: {
    label: 'Carrossel',
    icon: 'tabler-stack-2',
    accent: '#db2777',
  },
  officialAddress: {
    label: 'Endereço',
    icon: 'tabler-map',
    accent: '#16a34a',
  },
  officialTemplate: {
    label: 'Template oficial',
    icon: 'tabler-file-description',
    accent: '#2563eb',
  },
  officialLocation: {
    label: 'Localização',
    icon: 'tabler-map-pin',
    accent: '#16a34a',
  },
  officialContacts: {
    label: 'Contatos',
    icon: 'tabler-address-book',
    accent: '#0891b2',
  },
  officialSticker: {
    label: 'Sticker',
    icon: 'tabler-note',
    accent: '#f59e0b',
  },
  officialReaction: {
    label: 'Reação',
    icon: 'tabler-mood-smile',
    accent: '#ef4444',
  },
};

const currentMeta = computed(
  () =>
    OFFICIAL_NODE_META[nodeType.value] ?? {
      label: 'Oficial',
      icon: 'tabler-brand-whatsapp',
      accent: '#00a884',
    }
);

const optionNode = computed(
  () =>
    nodeType.value === 'officialReplyButtons' ||
    nodeType.value === 'officialList'
);

const continuationLabel = computed(() => {
  if (
    nodeType.value === 'officialLocationRequest' ||
    nodeType.value === 'officialFlow' ||
    nodeType.value === 'officialAddress'
  ) {
    return 'Após resposta';
  }

  return 'Continuar';
});

const maxOptions = computed(() =>
  nodeType.value === 'officialReplyButtons' ? 3 : 10
);

const optionTitle = computed(() =>
  nodeType.value === 'officialReplyButtons' ? 'Botões' : 'Linhas'
);

const createEmptyProductItem = (): OfficialProductItem => ({
  product_retailer_id: '',
});

const createProductSection = (title = 'Produtos'): OfficialProductSection => ({
  title,
  product_items: [createEmptyProductItem()],
});

const getProductRetailerId = (item: unknown): string => {
  if (typeof item === 'string') return item;
  if (!item || typeof item !== 'object') return '';

  const product = item as Record<string, unknown>;
  const value = product.product_retailer_id ?? product.productRetailerId;
  return typeof value === 'string' ? value : '';
};

const normalizeProductItems = (items: unknown[]): OfficialProductItem[] =>
  items.map((item) => ({
    product_retailer_id: getProductRetailerId(item),
  }));

const normalizeProductSections = (
  data?: OfficialNodeData
): OfficialProductSection[] => {
  const rawSections = Array.isArray(data?.sections) ? data.sections : [];
  const sections = rawSections.map((section, index) => {
    if (!section || typeof section !== 'object') {
      return createProductSection(`Seção ${index + 1}`);
    }

    const sectionRecord = section as Record<string, unknown>;
    const title =
      typeof sectionRecord.title === 'string' && sectionRecord.title.trim()
        ? sectionRecord.title
        : data?.sectionTitle || `Seção ${index + 1}`;
    const rawItems = Array.isArray(sectionRecord.product_items)
      ? sectionRecord.product_items
      : Array.isArray(sectionRecord.products)
        ? sectionRecord.products
        : [];
    const productItems = normalizeProductItems(rawItems);

    return {
      title,
      product_items: productItems.length
        ? productItems
        : [createEmptyProductItem()],
    };
  });

  if (sections.length > 0) return sections;

  const rawProducts = Array.isArray(data?.products) ? data.products : [];
  const products = normalizeProductItems(rawProducts);
  if (products.length > 0) {
    return [
      {
        title: data?.sectionTitle || 'Produtos',
        product_items: products,
      },
    ];
  }

  return [createProductSection(data?.sectionTitle || 'Produtos')];
};

const createCarouselCard = (): OfficialCarouselCard => ({
  body: '',
  mediaType: 'image',
  mediaUrl: '',
  mediaId: '',
  buttonText: 'Abrir',
  buttonUrl: '',
});

const normalizeCarouselCards = (cards?: unknown[]): OfficialCarouselCard[] => {
  const rawCards = Array.isArray(cards) ? cards : [];
  const normalizedCards: OfficialCarouselCard[] = rawCards.map((card) => {
    if (!card || typeof card !== 'object') return createCarouselCard();

    const cardRecord = card as Record<string, unknown>;
    const mediaType = cardRecord.mediaType === 'video' ? 'video' : 'image';

    return {
      body:
        typeof cardRecord.body === 'string'
          ? cardRecord.body
          : typeof cardRecord.text === 'string'
            ? cardRecord.text
            : '',
      mediaType,
      mediaUrl:
        typeof cardRecord.mediaUrl === 'string'
          ? cardRecord.mediaUrl
          : typeof cardRecord.media_url === 'string'
            ? cardRecord.media_url
            : '',
      mediaId:
        typeof cardRecord.mediaId === 'string'
          ? cardRecord.mediaId
          : typeof cardRecord.media_id === 'string'
            ? cardRecord.media_id
            : '',
      buttonText:
        typeof cardRecord.buttonText === 'string'
          ? cardRecord.buttonText
          : 'Abrir',
      buttonUrl:
        typeof cardRecord.buttonUrl === 'string'
          ? cardRecord.buttonUrl
          : typeof cardRecord.url === 'string'
            ? cardRecord.url
            : '',
    };
  });

  return normalizedCards.length ? normalizedCards : [createCarouselCard()];
};

const createTemplateVariable = (index = 0): OfficialTemplateVariable => ({
  ...createManualOfficialTemplateVariable(index),
});

const normalizeTemplateVariables = (
  variables?: unknown[]
): OfficialTemplateVariable[] => {
  const rawVariables = Array.isArray(variables) ? variables : [];

  return rawVariables.map((variable, index) => {
    if (!variable || typeof variable !== 'object') {
      return createTemplateVariable(index);
    }

    const variableRecord = variable as Record<string, unknown>;
    const componentType =
      variableRecord.component_type === 'HEADER' ||
      variableRecord.component_type === 'FOOTER' ||
      variableRecord.component_type === 'BUTTON'
        ? variableRecord.component_type
        : 'BODY';

    return refreshOfficialTemplateVariableKey({
      key:
        typeof variableRecord.key === 'string'
          ? variableRecord.key
          : `${componentType}:${index + 1}`,
      component_type: componentType,
      index:
        typeof variableRecord.index === 'number' && variableRecord.index > 0
          ? variableRecord.index
          : index + 1,
      button_index:
        typeof variableRecord.button_index === 'number'
          ? variableRecord.button_index
          : null,
      value:
        typeof variableRecord.value === 'string' ? variableRecord.value : '',
    });
  });
};

const createContactItem = (): OfficialContactItem => ({
  contact_id: null,
  name: '',
  last_name: '',
  phone: '',
  phone_ddi: '55',
  email: '',
});

const normalizeContacts = (contacts?: unknown[]): OfficialContactItem[] => {
  const rawContacts = Array.isArray(contacts) ? contacts : [];
  const normalizedContacts = rawContacts.map((contact) => {
    if (!contact || typeof contact !== 'object') return createContactItem();

    const contactRecord = contact as Record<string, unknown>;

    return {
      contact_id:
        typeof contactRecord.contact_id === 'string'
          ? contactRecord.contact_id
          : null,
      name: typeof contactRecord.name === 'string' ? contactRecord.name : '',
      last_name:
        typeof contactRecord.last_name === 'string'
          ? contactRecord.last_name
          : '',
      phone: typeof contactRecord.phone === 'string' ? contactRecord.phone : '',
      phone_ddi:
        typeof contactRecord.phone_ddi === 'string'
          ? contactRecord.phone_ddi
          : '55',
      email: typeof contactRecord.email === 'string' ? contactRecord.email : '',
    };
  });

  return normalizedContacts.length ? normalizedContacts : [createContactItem()];
};

const getInitialData = (): OfficialNodeData => {
  const data = props.data as OfficialNodeData | undefined;
  return {
    title: data?.title || currentMeta.value.label,
    message: data?.message || data?.text || '',
    text: data?.text || '',
    header: data?.header || '',
    footer: data?.footer || '',
    buttonText: data?.buttonText || defaultButtonText.value,
    url: data?.url || '',
    flowId: data?.flowId || '',
    flowName: data?.flowName || '',
    flowToken: data?.flowToken || '',
    flowAction: data?.flowAction || 'navigate',
    sectionTitle: data?.sectionTitle || '',
    catalogId: data?.catalogId || '',
    productRetailerId: data?.productRetailerId || '',
    latitude: data?.latitude ?? null,
    longitude: data?.longitude ?? null,
    name: data?.name || '',
    address: data?.address || '',
    addressCountry: data?.addressCountry || 'BR',
    templateName: data?.templateName || '',
    templateLanguage: data?.templateLanguage || 'pt_BR',
    templateCategory: data?.templateCategory ?? null,
    templateComponents: Array.isArray(data?.templateComponents)
      ? data.templateComponents
      : [],
    templatePreview:
      data?.templatePreview && typeof data.templatePreview === 'object'
        ? data.templatePreview
        : null,
    attachmentUrl: data?.attachmentUrl || '',
    attachmentMimetype: data?.attachmentMimetype || 'image/webp',
    emoji: data?.emoji || '👍',
    options: Array.isArray(data?.options) ? [...data.options] : [],
    products: Array.isArray(data?.products) ? data.products : [],
    sections:
      nodeType.value === 'officialMultiProduct'
        ? normalizeProductSections(data)
        : Array.isArray(data?.sections)
          ? data.sections
          : [],
    cards:
      nodeType.value === 'officialMediaCarousel'
        ? normalizeCarouselCards(data?.cards)
        : Array.isArray(data?.cards)
          ? data.cards
          : [],
    contacts:
      nodeType.value === 'officialContacts'
        ? normalizeContacts(data?.contacts)
        : Array.isArray(data?.contacts)
          ? data.contacts
          : [],
    templateVariables:
      nodeType.value === 'officialTemplate'
        ? normalizeTemplateVariables(data?.templateVariables)
        : Array.isArray(data?.templateVariables)
          ? data.templateVariables
          : [],
    parameters:
      data?.parameters && typeof data.parameters === 'object'
        ? data.parameters
        : {},
    action: data?.action && typeof data.action === 'object' ? data.action : {},
  };
};

const defaultButtonText = computed(() => {
  if (nodeType.value === 'officialList') return 'Selecionar';
  if (nodeType.value === 'officialFlow') return 'Abrir';
  if (nodeType.value === 'officialCtaUrl') return 'Abrir link';
  return 'Continuar';
});

const nodeData = ref<OfficialNodeData>(getInitialData());

const previewMessage = computed(() => {
  const text = nodeData.value.message || nodeData.value.text || '';
  if (text.trim()) return text;

  if (nodeType.value === 'officialLocation') {
    return nodeData.value.name || 'Localização';
  }

  if (nodeType.value === 'officialTemplate') {
    return nodeData.value.templateName || 'template_aprovado';
  }

  if (nodeType.value === 'officialSticker') {
    return 'Sticker WebP';
  }

  if (nodeType.value === 'officialReaction') {
    return nodeData.value.emoji || '👍';
  }

  return currentMeta.value.label;
});

const buildOptionHandleId = (optionId: string) => `option-${optionId}-source`;

const productSections = computed(
  () => (nodeData.value.sections ?? []) as OfficialProductSection[]
);

const carouselCards = computed(
  () => (nodeData.value.cards ?? []) as OfficialCarouselCard[]
);

const templateVariables = computed(
  () => (nodeData.value.templateVariables ?? []) as OfficialTemplateVariable[]
);

const availableOfficialTemplates = computed<OfficialTemplate[]>(() => {
  const data = props.data as OfficialNodeData | undefined;
  return Array.isArray(data?.availableOfficialTemplates)
    ? data.availableOfficialTemplates
    : [];
});

const isLoadingOfficialTemplates = computed(() => {
  const data = props.data as OfficialNodeData | undefined;
  return data?.isLoadingOfficialTemplates === true;
});

const officialTemplatesError = computed(() => {
  const data = props.data as OfficialNodeData | undefined;
  return typeof data?.officialTemplatesError === 'string'
    ? data.officialTemplatesError
    : null;
});

const selectedOfficialTemplateKey = computed({
  get: () =>
    nodeData.value.templateName && nodeData.value.templateLanguage
      ? buildOfficialTemplateKey({
          name: nodeData.value.templateName,
          language: nodeData.value.templateLanguage,
        })
      : null,
  set: (key: string | null) => {
    const option = officialTemplateOptions.value.find(
      (item) => item.value === key
    );
    const template =
      option?.template ??
      findOfficialTemplate(availableOfficialTemplates.value, key);

    if (!template) {
      nodeData.value.templateName = '';
      nodeData.value.templateLanguage = 'pt_BR';
      nodeData.value.templateCategory = null;
      nodeData.value.templateComponents = [];
      nodeData.value.templatePreview = null;
      nodeData.value.templateVariables = [];
      updateNodeData();
      return;
    }

    applyOfficialTemplate(template);
  },
});

const selectedTemplateFromList = computed(() =>
  findOfficialTemplate(
    availableOfficialTemplates.value,
    selectedOfficialTemplateKey.value
  )
);

const savedOfficialTemplate = computed<OfficialTemplate | null>(() => {
  if (!nodeData.value.templateName || !nodeData.value.templateLanguage) {
    return null;
  }

  const components = Array.isArray(nodeData.value.templateComponents)
    ? nodeData.value.templateComponents
    : [];
  const preview =
    nodeData.value.templatePreview &&
    typeof nodeData.value.templatePreview === 'object'
      ? nodeData.value.templatePreview
      : {};
  const variables = templateVariables.value.map((variable) => ({
    key: variable.key,
    component_type: variable.component_type,
    index: variable.index,
    button_index: variable.button_index ?? null,
  }));

  return {
    name: nodeData.value.templateName,
    language: nodeData.value.templateLanguage,
    status: 'APPROVED',
    category: nodeData.value.templateCategory ?? null,
    components,
    variables,
    preview,
  };
});

const selectedOfficialTemplate = computed(
  () => selectedTemplateFromList.value ?? savedOfficialTemplate.value
);

const officialTemplateOptions = computed(() => {
  const options = createOfficialTemplateOptions(
    availableOfficialTemplates.value,
    locale.value
  );

  if (
    selectedOfficialTemplate.value &&
    !options.some(
      (option) => option.value === selectedOfficialTemplateKey.value
    )
  ) {
    return [
      {
        value: buildOfficialTemplateKey(selectedOfficialTemplate.value),
        title: selectedOfficialTemplate.value.name,
        name: selectedOfficialTemplate.value.name,
        language: selectedOfficialTemplate.value.language,
        languageLabel: formatOfficialTemplateLanguage(
          selectedOfficialTemplate.value.language,
          locale.value
        ),
        category: selectedOfficialTemplate.value.category ?? null,
        template: selectedOfficialTemplate.value,
      },
      ...options,
    ];
  }

  return options;
});

const hasDetectedTemplateVariables = computed(
  () => (selectedTemplateFromList.value?.variables.length ?? 0) > 0
);

const officialTemplatePreview = computed(() =>
  buildOfficialTemplatePreview(
    selectedOfficialTemplate.value,
    templateVariables.value,
    templateVariables.value
  )
);

const previewHeader = computed(() =>
  nodeType.value === 'officialTemplate'
    ? officialTemplatePreview.value?.header || ''
    : nodeData.value.header || ''
);

const previewBody = computed(() =>
  nodeType.value === 'officialTemplate'
    ? officialTemplatePreview.value?.body || previewMessage.value
    : previewMessage.value
);

const previewFooter = computed(() =>
  nodeType.value === 'officialTemplate'
    ? officialTemplatePreview.value?.footer || ''
    : nodeData.value.footer || ''
);

const previewButtons = computed(() =>
  nodeType.value === 'officialTemplate'
    ? (officialTemplatePreview.value?.buttons ?? [])
    : []
);

const contactItems = computed(
  () => (nodeData.value.contacts ?? []) as OfficialContactItem[]
);

const totalProductItems = computed(() =>
  productSections.value.reduce(
    (total, section) => total + section.product_items.length,
    0
  )
);

const syncProductSections = () => {
  const sections = normalizeProductSections(nodeData.value);
  nodeData.value.sections = sections;
  nodeData.value.products = sections.flatMap((section) =>
    section.product_items.map((item) => ({
      product_retailer_id: item.product_retailer_id,
    }))
  );
  updateNodeData();
};

const addProductSection = () => {
  if (productSections.value.length >= 10) return;

  nodeData.value.sections = [
    ...productSections.value,
    createProductSection(`Seção ${productSections.value.length + 1}`),
  ];
  syncProductSections();
};

const removeProductSection = (sectionIndex: number) => {
  const sections = [...productSections.value];
  sections.splice(sectionIndex, 1);
  nodeData.value.sections = sections.length
    ? sections
    : [createProductSection()];
  syncProductSections();
};

const addProductItem = (sectionIndex: number) => {
  if (totalProductItems.value >= 30) return;

  const section = productSections.value[sectionIndex];
  if (!section) return;

  section.product_items.push(createEmptyProductItem());
  syncProductSections();
};

const removeProductItem = (sectionIndex: number, productIndex: number) => {
  const section = productSections.value[sectionIndex];
  if (!section) return;

  section.product_items.splice(productIndex, 1);
  if (section.product_items.length === 0) {
    section.product_items.push(createEmptyProductItem());
  }
  syncProductSections();
};

const syncCarouselCards = () => {
  nodeData.value.cards = normalizeCarouselCards(nodeData.value.cards);
  updateNodeData();
};

const addCarouselCard = () => {
  if (carouselCards.value.length >= 10) return;
  nodeData.value.cards = [...carouselCards.value, createCarouselCard()];
  syncCarouselCards();
};

const removeCarouselCard = (cardIndex: number) => {
  const cards = [...carouselCards.value];
  cards.splice(cardIndex, 1);
  nodeData.value.cards = cards.length ? cards : [createCarouselCard()];
  syncCarouselCards();
};

const syncTemplateVariables = () => {
  nodeData.value.templateVariables = normalizeTemplateVariables(
    nodeData.value.templateVariables
  );
  updateNodeData();
};

const applyOfficialTemplate = (template: OfficialTemplate) => {
  nodeData.value.templateName = template.name;
  nodeData.value.templateLanguage = template.language;
  nodeData.value.templateCategory = template.category ?? null;
  nodeData.value.templateComponents = template.components;
  nodeData.value.templatePreview = template.preview;
  nodeData.value.templateVariables = createOfficialTemplateVariableValues(
    template.variables,
    templateVariables.value
  );
  updateNodeData();
};

const addTemplateVariable = () => {
  nodeData.value.templateVariables = [
    ...templateVariables.value,
    createTemplateVariable(templateVariables.value.length),
  ];
  syncTemplateVariables();
};

const removeTemplateVariable = (variableIndex: number) => {
  const variables = [...templateVariables.value];
  variables.splice(variableIndex, 1);
  nodeData.value.templateVariables = variables;
  syncTemplateVariables();
};

const syncTemplateVariableKey = (variableIndex: number) => {
  const variable = templateVariables.value[variableIndex];
  if (!variable) {
    return;
  }

  const variables = [...templateVariables.value];
  variables[variableIndex] = refreshOfficialTemplateVariableKey(variable);
  nodeData.value.templateVariables = variables;
  syncTemplateVariables();
};

const syncContacts = () => {
  nodeData.value.contacts = normalizeContacts(nodeData.value.contacts);
  updateNodeData();
};

const addContact = () => {
  nodeData.value.contacts = [...contactItems.value, createContactItem()];
  syncContacts();
};

const removeContact = (contactIndex: number) => {
  const contacts = [...contactItems.value];
  contacts.splice(contactIndex, 1);
  nodeData.value.contacts = contacts.length ? contacts : [createContactItem()];
  syncContacts();
};

const getNextOptionId = () => {
  const numericIds = (nodeData.value.options ?? [])
    .map((option) => Number(option.id))
    .filter((id) => !Number.isNaN(id));

  const maxId = numericIds.length ? Math.max(...numericIds) : 0;
  return (maxId + 1).toString();
};

const updateNodeData = () => {
  if (!props.data) return;

  const data = props.data as OfficialNodeData;
  data.title = nodeData.value.title || currentMeta.value.label;
  data.message = nodeData.value.message || '';
  data.text = nodeData.value.message || '';
  data.header = nodeData.value.header || '';
  data.footer = nodeData.value.footer || '';
  data.buttonText = nodeData.value.buttonText || defaultButtonText.value;
  data.url = nodeData.value.url || '';
  data.flowId = nodeData.value.flowId || '';
  data.flowName = nodeData.value.flowName || '';
  data.flowToken = nodeData.value.flowToken || '';
  data.flowAction = nodeData.value.flowAction || 'navigate';
  data.sectionTitle = nodeData.value.sectionTitle || '';
  data.catalogId = nodeData.value.catalogId || '';
  data.productRetailerId = nodeData.value.productRetailerId || '';
  data.latitude =
    nodeData.value.latitude === '' ||
    nodeData.value.latitude === null ||
    nodeData.value.latitude === undefined
      ? null
      : String(nodeData.value.latitude);
  data.longitude =
    nodeData.value.longitude === '' ||
    nodeData.value.longitude === null ||
    nodeData.value.longitude === undefined
      ? null
      : String(nodeData.value.longitude);
  data.name = nodeData.value.name || '';
  data.address = nodeData.value.address || '';
  data.addressCountry = nodeData.value.addressCountry || 'BR';
  data.templateName = nodeData.value.templateName || '';
  data.templateLanguage = nodeData.value.templateLanguage || 'pt_BR';
  data.templateCategory = nodeData.value.templateCategory ?? null;
  data.templateComponents = Array.isArray(nodeData.value.templateComponents)
    ? nodeData.value.templateComponents
    : [];
  data.templatePreview =
    nodeData.value.templatePreview &&
    typeof nodeData.value.templatePreview === 'object'
      ? nodeData.value.templatePreview
      : null;
  data.attachmentUrl = nodeData.value.attachmentUrl || '';
  data.attachmentMimetype = nodeData.value.attachmentMimetype || 'image/webp';
  data.emoji = nodeData.value.emoji || '👍';
  data.options = [...(nodeData.value.options ?? [])];
  if (nodeType.value === 'officialMultiProduct') {
    const sections = normalizeProductSections(nodeData.value);
    data.sectionTitle = sections[0]?.title || '';
    data.sections = sections;
    data.products = sections.flatMap((section) =>
      section.product_items.map((item) => ({
        product_retailer_id: item.product_retailer_id,
      }))
    );
  } else {
    delete data.products;
    delete data.sections;
  }
  data.cards =
    nodeType.value === 'officialMediaCarousel'
      ? normalizeCarouselCards(nodeData.value.cards)
      : Array.isArray(nodeData.value.cards)
        ? nodeData.value.cards
        : [];
  data.contacts =
    nodeType.value === 'officialContacts'
      ? normalizeContacts(nodeData.value.contacts)
      : Array.isArray(nodeData.value.contacts)
        ? nodeData.value.contacts
        : [];
  data.templateVariables =
    nodeType.value === 'officialTemplate'
      ? normalizeTemplateVariables(nodeData.value.templateVariables)
      : Array.isArray(nodeData.value.templateVariables)
        ? nodeData.value.templateVariables
        : [];
  data.parameters =
    nodeData.value.parameters && typeof nodeData.value.parameters === 'object'
      ? nodeData.value.parameters
      : {};
  data.action =
    nodeType.value === 'officialAddress'
      ? {
          name: 'address_message',
          parameters: {
            country: nodeData.value.addressCountry || 'BR',
          },
        }
      : nodeData.value.action && typeof nodeData.value.action === 'object'
        ? nodeData.value.action
        : {};
  data.officialType = nodeType.value;
  data.official = {
    ...(data.official as Record<string, unknown> | undefined),
    type: nodeType.value,
  } as never;
};

const addOption = () => {
  if ((nodeData.value.options ?? []).length >= maxOptions.value) return;

  nodeData.value.options = [
    ...(nodeData.value.options ?? []),
    { id: getNextOptionId(), text: '' },
  ];
  updateNodeData();
  nextTick(() => updateNodeInternals([props.id]));
};

const removeOption = (index: number) => {
  const option = nodeData.value.options?.[index];
  if (!option) return;

  const data = props.data as OfficialNodeData;
  data?.onRemoveOption?.(option.id);
  nodeData.value.options?.splice(index, 1);
  updateNodeData();
  nextTick(() => updateNodeInternals([props.id]));
};

const handleRemove = () => {
  const data = props.data as OfficialNodeData;
  data?.onRemove?.();
};

const hasTemplateMetadata = () =>
  Array.isArray(nodeData.value.templateComponents) &&
  nodeData.value.templateComponents.length > 0 &&
  Boolean(nodeData.value.templatePreview);

const hasTemplateVariableRows = (template: OfficialTemplate) =>
  template.variables.length === 0 ||
  template.variables.every((variable) =>
    templateVariables.value.some((current) => current.key === variable.key)
  );

watch(
  selectedTemplateFromList,
  (template) => {
    if (nodeType.value !== 'officialTemplate' || !template) {
      return;
    }

    if (!hasTemplateMetadata() || !hasTemplateVariableRows(template)) {
      applyOfficialTemplate(template);
    }
  },
  { immediate: true }
);

watch(
  () => nodeData.value,
  () => updateNodeData(),
  { deep: true }
);
</script>

<template>
  <div class="chatbot-official-node">
    <Handle
      id="target"
      type="target"
      :position="Position.Top"
      class="handle-target"
    />
    <Handle
      v-if="!optionNode"
      id="source"
      type="source"
      :position="Position.Bottom"
      class="handle-source"
    />

    <VCard class="official-card" elevation="2">
      <VCardTitle class="official-title node-drag-handle">
        <div class="d-flex align-center ga-2 min-w-0">
          <VIcon
            :icon="currentMeta.icon"
            :color="currentMeta.accent"
            size="20"
          />
          <span class="official-node-title">{{ currentMeta.label }}</span>
        </div>
        <VIcon
          v-if="(props.data as OfficialNodeData)?.onRemove"
          icon="tabler-x"
          size="18"
          color="error"
          class="cursor-pointer"
          @click.stop="handleRemove"
        />
      </VCardTitle>

      <VCardText class="pa-3">
        <div class="whatsapp-preview mb-3">
          <div class="whatsapp-bubble">
            <div v-if="previewHeader" class="preview-header">
              {{ previewHeader }}
            </div>
            <div class="preview-body">{{ previewBody }}</div>
            <div v-if="previewFooter" class="preview-footer">
              {{ previewFooter }}
            </div>

            <div
              v-if="nodeType === 'officialReplyButtons'"
              class="preview-actions"
            >
              <div
                v-for="option in nodeData.options"
                :key="`preview-${option.id}`"
                class="preview-button"
              >
                {{ option.text || 'Botão' }}
              </div>
            </div>

            <div v-else-if="nodeType === 'officialList'" class="preview-list">
              <div class="preview-list-button">
                {{ nodeData.buttonText || 'Selecionar' }}
              </div>
              <div
                v-for="option in nodeData.options"
                :key="`row-${option.id}`"
                class="preview-row"
              >
                <span>{{ option.text || 'Linha' }}</span>
                <small v-if="option.description">{{
                  option.description
                }}</small>
              </div>
            </div>

            <div
              v-else-if="nodeType === 'officialCtaUrl'"
              class="preview-actions"
            >
              <div class="preview-button">
                {{ nodeData.buttonText || 'Abrir link' }}
              </div>
            </div>

            <div
              v-else-if="
                nodeType === 'officialTemplate' && previewButtons.length
              "
              class="preview-actions"
            >
              <div
                v-for="(button, index) in previewButtons"
                :key="`template-preview-button-${index}`"
                class="preview-button"
              >
                {{ button }}
              </div>
            </div>

            <div v-else class="preview-continuation">
              {{ continuationLabel }}
            </div>
          </div>
        </div>

        <div class="official-fields nodrag">
          <VTextField
            v-model="nodeData.title"
            placeholder="Título interno"
            variant="outlined"
            density="compact"
            hide-details
          />

          <VTextarea
            v-if="
              ![
                'officialTemplate',
                'officialLocation',
                'officialContacts',
                'officialSticker',
                'officialReaction',
              ].includes(nodeType)
            "
            v-model="nodeData.message"
            placeholder="Mensagem"
            variant="outlined"
            density="compact"
            rows="2"
            hide-details
          />

          <div v-if="optionNode" class="option-block">
            <div class="option-block-header">
              <span>{{ optionTitle }}</span>
              <VBtn
                size="small"
                variant="outlined"
                color="primary"
                :disabled="(nodeData.options?.length ?? 0) >= maxOptions"
                @click="addOption"
              >
                <VIcon icon="tabler-plus" size="16" class="me-1" />
                Adicionar
              </VBtn>
            </div>

            <div
              v-for="(option, index) in nodeData.options"
              :key="option.id"
              class="official-option"
            >
              <VTextField
                v-model="option.text"
                placeholder="Texto"
                variant="outlined"
                density="compact"
                hide-details
              />
              <VTextField
                v-if="nodeType === 'officialList'"
                v-model="option.description"
                placeholder="Descrição"
                variant="outlined"
                density="compact"
                hide-details
              />
              <VBtn
                icon
                size="small"
                variant="text"
                color="error"
                @click.stop="removeOption(index)"
              >
                <VIcon icon="tabler-x" size="16" />
              </VBtn>
              <Handle
                :id="buildOptionHandleId(option.id)"
                type="source"
                :position="Position.Right"
                class="option-handle handle-source"
                @mousedown.stop
                @touchstart.stop
              />
            </div>
          </div>

          <VTextField
            v-if="
              ['officialList', 'officialCtaUrl', 'officialFlow'].includes(
                nodeType
              )
            "
            v-model="nodeData.buttonText"
            placeholder="Texto do botão"
            variant="outlined"
            density="compact"
            hide-details
          />

          <VTextField
            v-if="nodeType === 'officialCtaUrl'"
            v-model="nodeData.url"
            placeholder="https://..."
            prepend-inner-icon="tabler-link"
            variant="outlined"
            density="compact"
            hide-details
          />

          <div v-if="nodeType === 'officialFlow'" class="split-fields">
            <VTextField
              v-model="nodeData.flowId"
              placeholder="Flow ID"
              variant="outlined"
              density="compact"
              hide-details
            />
            <VTextField
              v-model="nodeData.flowName"
              placeholder="Flow name"
              variant="outlined"
              density="compact"
              hide-details
            />
          </div>

          <div
            v-if="
              ['officialSingleProduct', 'officialMultiProduct'].includes(
                nodeType
              )
            "
            class="split-fields"
          >
            <VTextField
              v-model="nodeData.catalogId"
              placeholder="Catalog ID"
              variant="outlined"
              density="compact"
              hide-details
            />
            <VTextField
              v-if="nodeType === 'officialSingleProduct'"
              v-model="nodeData.productRetailerId"
              placeholder="Product retailer ID"
              variant="outlined"
              density="compact"
              hide-details
            />
          </div>

          <div
            v-if="nodeType === 'officialMultiProduct'"
            class="product-sections"
          >
            <div class="product-sections-header">
              <span>Seções e produtos</span>
              <VBtn
                size="small"
                variant="outlined"
                color="primary"
                :disabled="productSections.length >= 10"
                @click="addProductSection"
              >
                <VIcon icon="tabler-plus" size="16" class="me-1" />
                Seção
              </VBtn>
            </div>

            <div
              v-for="(section, sectionIndex) in productSections"
              :key="`product-section-${sectionIndex}`"
              class="product-section-card"
            >
              <div class="product-section-header">
                <VTextField
                  v-model="section.title"
                  placeholder="Título da seção"
                  variant="outlined"
                  density="compact"
                  hide-details
                  @update:model-value="syncProductSections"
                />
                <VBtn
                  icon
                  size="small"
                  variant="text"
                  color="error"
                  :disabled="productSections.length <= 1"
                  @click.stop="removeProductSection(sectionIndex)"
                >
                  <VIcon icon="tabler-x" size="16" />
                </VBtn>
              </div>

              <div
                v-for="(product, productIndex) in section.product_items"
                :key="`product-${sectionIndex}-${productIndex}`"
                class="product-item-row"
              >
                <VTextField
                  v-model="product.product_retailer_id"
                  placeholder="ID do produto"
                  prepend-inner-icon="tabler-package"
                  variant="outlined"
                  density="compact"
                  hide-details
                  @update:model-value="syncProductSections"
                />
                <VBtn
                  icon
                  size="small"
                  variant="text"
                  color="error"
                  :disabled="section.product_items.length <= 1"
                  @click.stop="removeProductItem(sectionIndex, productIndex)"
                >
                  <VIcon icon="tabler-x" size="16" />
                </VBtn>
              </div>

              <VBtn
                size="small"
                variant="text"
                color="primary"
                class="product-add-btn"
                :disabled="totalProductItems >= 30"
                @click="addProductItem(sectionIndex)"
              >
                <VIcon icon="tabler-plus" size="16" class="me-1" />
                Produto
              </VBtn>
            </div>
          </div>

          <div
            v-if="nodeType === 'officialMediaCarousel'"
            class="structured-list"
          >
            <div class="structured-list-header">
              <span>Cards</span>
              <VBtn
                size="small"
                variant="outlined"
                color="primary"
                :disabled="carouselCards.length >= 10"
                @click="addCarouselCard"
              >
                <VIcon icon="tabler-plus" size="16" class="me-1" />
                Card
              </VBtn>
            </div>

            <div
              v-for="(card, cardIndex) in carouselCards"
              :key="`carousel-card-${cardIndex}`"
              class="structured-card"
            >
              <div class="structured-card-header">
                <span>Card {{ cardIndex + 1 }}</span>
                <VBtn
                  icon
                  size="small"
                  variant="text"
                  color="error"
                  :disabled="carouselCards.length <= 1"
                  @click.stop="removeCarouselCard(cardIndex)"
                >
                  <VIcon icon="tabler-x" size="16" />
                </VBtn>
              </div>

              <VTextarea
                v-model="card.body"
                placeholder="Texto do card"
                variant="outlined"
                density="compact"
                rows="2"
                hide-details
                @update:model-value="syncCarouselCards"
              />

              <div class="split-fields">
                <VSelect
                  v-model="card.mediaType"
                  :items="['image', 'video']"
                  placeholder="Tipo de mídia"
                  variant="outlined"
                  density="compact"
                  hide-details
                  @update:model-value="syncCarouselCards"
                />
                <VTextField
                  v-model="card.mediaUrl"
                  placeholder="URL da mídia"
                  prepend-inner-icon="tabler-link"
                  variant="outlined"
                  density="compact"
                  hide-details
                  @update:model-value="syncCarouselCards"
                />
              </div>

              <div class="split-fields">
                <VTextField
                  v-model="card.buttonText"
                  placeholder="Texto do botão"
                  variant="outlined"
                  density="compact"
                  hide-details
                  @update:model-value="syncCarouselCards"
                />
                <VTextField
                  v-model="card.buttonUrl"
                  placeholder="URL do botão"
                  prepend-inner-icon="tabler-link"
                  variant="outlined"
                  density="compact"
                  hide-details
                  @update:model-value="syncCarouselCards"
                />
              </div>
            </div>
          </div>

          <div v-if="nodeType === 'officialTemplate'" class="template-select">
            <VAlert
              v-if="officialTemplatesError"
              type="error"
              variant="tonal"
              density="compact"
            >
              {{ officialTemplatesError }}
            </VAlert>
            <VAlert
              v-else-if="
                !isLoadingOfficialTemplates &&
                officialTemplateOptions.length === 0
              "
              type="warning"
              variant="tonal"
              density="compact"
            >
              Nenhum template oficial aprovado disponível.
            </VAlert>
            <AppSelectSearch
              v-model="selectedOfficialTemplateKey"
              :items="officialTemplateOptions"
              placeholder="Selecione o template aprovado"
              item-value="value"
              item-title="title"
              :loading="isLoadingOfficialTemplates"
              :disabled="isLoadingOfficialTemplates"
            />

            <div v-if="selectedOfficialTemplate" class="template-meta-chips">
              <VChip size="small" color="success" variant="tonal">
                <VIcon size="15" class="me-1">tabler-circle-check</VIcon>
                Aprovado
              </VChip>
              <VChip size="small" color="primary" variant="tonal">
                <VIcon size="15" class="me-1">tabler-language</VIcon>
                {{
                  officialTemplateOptions.find(
                    (option) => option.value === selectedOfficialTemplateKey
                  )?.languageLabel || selectedOfficialTemplate.language
                }}
              </VChip>
              <VChip
                v-if="selectedOfficialTemplate.category"
                size="small"
                color="secondary"
                variant="tonal"
              >
                <VIcon size="15" class="me-1">tabler-tag</VIcon>
                {{ selectedOfficialTemplate.category }}
              </VChip>
            </div>
          </div>

          <div v-if="nodeType === 'officialTemplate'" class="structured-list">
            <div class="structured-list-header">
              <span>Variáveis</span>
              <VBtn
                v-if="!hasDetectedTemplateVariables"
                size="small"
                variant="outlined"
                color="primary"
                @click="addTemplateVariable"
              >
                <VIcon icon="tabler-plus" size="16" class="me-1" />
                Variável
              </VBtn>
            </div>

            <div
              v-for="(variable, variableIndex) in templateVariables"
              :key="`template-variable-${variableIndex}`"
              :class="
                hasDetectedTemplateVariables
                  ? 'template-variable-value-row'
                  : 'structured-row'
              "
            >
              <VSelect
                v-if="!hasDetectedTemplateVariables"
                v-model="variable.component_type"
                :items="['HEADER', 'BODY', 'BUTTON']"
                placeholder="Componente"
                variant="outlined"
                density="compact"
                hide-details
                @update:model-value="syncTemplateVariableKey(variableIndex)"
              />
              <VTextField
                v-if="!hasDetectedTemplateVariables"
                v-model.number="variable.index"
                placeholder="Índice"
                type="number"
                variant="outlined"
                density="compact"
                hide-details
                @update:model-value="syncTemplateVariableKey(variableIndex)"
              />
              <VTextField
                v-model="variable.value"
                :label="`${variable.component_type} {{${variable.index}}}`"
                placeholder="Valor"
                variant="outlined"
                density="compact"
                hide-details
                @update:model-value="syncTemplateVariables"
              />
              <VBtn
                v-if="!hasDetectedTemplateVariables"
                icon
                size="small"
                variant="text"
                color="error"
                @click.stop="removeTemplateVariable(variableIndex)"
              >
                <VIcon icon="tabler-x" size="16" />
              </VBtn>
            </div>
          </div>

          <div v-if="nodeType === 'officialLocation'" class="split-fields">
            <VTextField
              v-model="nodeData.latitude"
              placeholder="Latitude"
              type="number"
              variant="outlined"
              density="compact"
              hide-details
            />
            <VTextField
              v-model="nodeData.longitude"
              placeholder="Longitude"
              type="number"
              variant="outlined"
              density="compact"
              hide-details
            />
          </div>

          <div v-if="nodeType === 'officialLocation'" class="split-fields">
            <VTextField
              v-model="nodeData.name"
              placeholder="Nome"
              variant="outlined"
              density="compact"
              hide-details
            />
            <VTextField
              v-model="nodeData.address"
              placeholder="Endereço"
              variant="outlined"
              density="compact"
              hide-details
            />
          </div>

          <div v-if="nodeType === 'officialContacts'" class="structured-list">
            <div class="structured-list-header">
              <span>Contatos</span>
              <VBtn
                size="small"
                variant="outlined"
                color="primary"
                @click="addContact"
              >
                <VIcon icon="tabler-plus" size="16" class="me-1" />
                Contato
              </VBtn>
            </div>

            <div
              v-for="(contact, contactIndex) in contactItems"
              :key="`contact-${contactIndex}`"
              class="structured-card"
            >
              <div class="structured-card-header">
                <span>Contato {{ contactIndex + 1 }}</span>
                <VBtn
                  icon
                  size="small"
                  variant="text"
                  color="error"
                  :disabled="contactItems.length <= 1"
                  @click.stop="removeContact(contactIndex)"
                >
                  <VIcon icon="tabler-x" size="16" />
                </VBtn>
              </div>

              <div class="split-fields">
                <VTextField
                  v-model="contact.name"
                  placeholder="Nome"
                  variant="outlined"
                  density="compact"
                  hide-details
                  @update:model-value="syncContacts"
                />
                <VTextField
                  v-model="contact.last_name"
                  placeholder="Sobrenome"
                  variant="outlined"
                  density="compact"
                  hide-details
                  @update:model-value="syncContacts"
                />
              </div>

              <div class="split-fields">
                <VTextField
                  v-model="contact.phone_ddi"
                  placeholder="DDI"
                  variant="outlined"
                  density="compact"
                  hide-details
                  @update:model-value="syncContacts"
                />
                <VTextField
                  v-model="contact.phone"
                  placeholder="Telefone"
                  variant="outlined"
                  density="compact"
                  hide-details
                  @update:model-value="syncContacts"
                />
              </div>

              <VTextField
                v-model="contact.email"
                placeholder="E-mail"
                variant="outlined"
                density="compact"
                hide-details
                @update:model-value="syncContacts"
              />
            </div>
          </div>

          <VTextField
            v-if="nodeType === 'officialSticker'"
            v-model="nodeData.attachmentUrl"
            placeholder="URL do WebP"
            prepend-inner-icon="tabler-link"
            variant="outlined"
            density="compact"
            hide-details
          />

          <VTextField
            v-if="nodeType === 'officialReaction'"
            v-model="nodeData.emoji"
            placeholder="Emoji"
            variant="outlined"
            density="compact"
            hide-details
          />

          <VTextField
            v-if="nodeType === 'officialAddress'"
            v-model="nodeData.addressCountry"
            placeholder="País"
            prepend-inner-icon="tabler-map"
            variant="outlined"
            density="compact"
            hide-details
          />
        </div>
      </VCardText>
    </VCard>
  </div>
</template>

<style scoped>
.chatbot-official-node {
  min-width: 340px;
  max-width: 380px;
}

.official-card {
  border-radius: 8px;
  overflow: visible;
}

.official-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  min-height: 42px;
}

.official-node-title {
  min-width: 0;
  overflow: hidden;
  font-size: 0.875rem;
  font-weight: 600;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.whatsapp-preview {
  background: #efe7dd;
  border: 1px solid rgba(17, 24, 39, 0.08);
  border-radius: 8px;
  padding: 10px;
}

.whatsapp-bubble {
  max-width: 100%;
  background: #ffffff;
  border-radius: 7px;
  box-shadow: 0 1px 1px rgba(17, 24, 39, 0.12);
  color: #111827;
  overflow: hidden;
}

.preview-header,
.preview-body,
.preview-footer {
  padding-inline: 10px;
}

.preview-header {
  padding-top: 8px;
  color: #111827;
  font-size: 0.78rem;
  font-weight: 700;
}

.preview-body {
  padding-top: 8px;
  padding-bottom: 6px;
  font-size: 0.82rem;
  line-height: 1.35;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.preview-footer {
  padding-bottom: 8px;
  color: #6b7280;
  font-size: 0.68rem;
  line-height: 1.25;
}

.preview-actions,
.preview-list {
  border-top: 1px solid rgba(17, 24, 39, 0.08);
}

.preview-button,
.preview-list-button,
.preview-continuation {
  color: #0284c7;
  font-size: 0.8rem;
  font-weight: 600;
  line-height: 1.2;
  padding: 9px 10px;
  text-align: center;
}

.preview-button + .preview-button {
  border-top: 1px solid rgba(17, 24, 39, 0.08);
}

.preview-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-top: 1px solid rgba(17, 24, 39, 0.06);
  padding: 8px 10px;
}

.preview-row span {
  font-size: 0.78rem;
  line-height: 1.15;
}

.preview-row small {
  color: #6b7280;
  font-size: 0.68rem;
  line-height: 1.1;
}

.preview-continuation {
  border-top: 1px solid rgba(17, 24, 39, 0.08);
}

.official-fields {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.option-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.option-block-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 0.78rem;
  font-weight: 600;
}

.product-sections {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.product-sections-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 0.78rem;
  font-weight: 600;
}

.product-section-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.025);
}

.product-section-header,
.product-item-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
}

.product-add-btn {
  align-self: flex-start;
}

.structured-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.structured-list-header,
.structured-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 0.78rem;
  font-weight: 600;
}

.structured-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.025);
}

.template-select {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.template-meta-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.structured-row {
  display: grid;
  grid-template-columns: minmax(84px, 0.85fr) 72px minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
}

.template-variable-value-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 8px;
}

.official-option {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  padding-right: 8px;
}

.official-option .v-input:nth-child(2) {
  grid-column: 1 / -1;
}

.option-handle {
  position: absolute;
  top: 50%;
  right: -22px;
  z-index: 12;
  transform: translateY(-50%);
}

.split-fields {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 8px;
}
</style>
