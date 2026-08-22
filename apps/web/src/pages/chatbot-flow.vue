<script setup lang="ts">
import {
  ref,
  markRaw,
  computed,
  onMounted,
  onUnmounted,
  watch,
  nextTick,
  useTemplateRef,
} from 'vue';
import { VueFlow } from '@vue-flow/core';
import type { Node, Edge, Connection, NodeChange } from '@vue-flow/core';
import { useDisplay } from 'vuetify';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EChatbotPermissions } from '@core/common/enums/EPermissions/chatbot';
import { EAiAgentPermissions } from '@core/common/enums/EPermissions/aiAgent';
import { EColor } from '@core/common/enums/EColor';
import { can } from '@/@layouts/plugins/casl';
import ChatbotMenuNode from '@/components/chatbot/ChatbotMenuNode.vue';
import ChatbotStartNode from '@/components/chatbot/ChatbotStartNode.vue';
import ChatbotSatisfactionNode from '@/components/chatbot/ChatbotSatisfactionNode.vue';
import ChatbotRedirectNode from '@/components/chatbot/ChatbotRedirectNode.vue';
import ChatbotFinishNode from '@/components/chatbot/ChatbotFinishNode.vue';
import ChatbotTagNode from '@/components/chatbot/ChatbotTagNode.vue';
import ChatbotMessageNode from '@/components/chatbot/ChatbotMessageNode.vue';
import ChatbotDataNode from '@/components/chatbot/ChatbotDataNode.vue';
import ChatbotUnderchatNode from '@/components/chatbot/ChatbotUnderchatNode.vue';
import ChatbotContactNode from '@/components/chatbot/ChatbotContactNode.vue';
import ChatbotAiAgentNode from '@/components/chatbot/ChatbotAiAgentNode.vue';
import ChatbotAnnotationNode from '@/components/chatbot/ChatbotAnnotationNode.vue';
import ChatbotDistributionNode from '@/components/chatbot/ChatbotDistributionNode.vue';
import ChatbotConditionalNode from '@/components/chatbot/ChatbotConditionalNode.vue';
import ChatbotRandomMessageNode from '@/components/chatbot/ChatbotRandomMessageNode.vue';
import ChatbotWeekdayNode from '@/components/chatbot/ChatbotWeekdayNode.vue';
import ChatbotHoursNode from '@/components/chatbot/ChatbotHoursNode.vue';
import ChatbotHolidayNode from '@/components/chatbot/ChatbotHolidayNode.vue';
import ChatbotOfficialNode from '@/components/chatbot/ChatbotOfficialNode.vue';
import ChatbotInactivityAlertConfig from '@/components/chatbot/ChatbotInactivityAlertConfig.vue';
import ChatbotNodePalette from '@/components/chatbot/ChatbotNodePalette.vue';
import ChatbotApiRequestNode from '@/components/chatbot/api-request/ChatbotApiRequestNode.vue';
import {
  createDefaultApiRequestConfig,
  formatApiVariableTag,
  getNextApiOutputKey,
  markApiRequestChanged,
  normalizeApiRequestConfig,
  type ApiRequestConfig,
  type ApiRequestTestInput,
  type ApiRequestTestResult,
  type ApiRequestVariable,
} from '@/components/chatbot/api-request/types';
import {
  OFFICIAL_CHATBOT_NODE_TYPES,
  isOfficialChatbotNodeType,
  isOfficialWaitForResponseNodeType,
} from '@core/common/functions/chatbotOfficialNodes';
import {
  computeChatbotFlowDominators,
  getUpstreamApiContracts,
  isChatbotNodeOutputAvailableAtNode,
  validateChatbotApiVariableDependencies,
} from '@core/common/functions/chatbotApiGraph';
import {
  formatChatbotNodeOutputTag,
  getChatbotNodeOutputDefinition,
  getNextChatbotNodeOutputKey,
  isChatbotCaptureNodeType,
  isChatbotNodeOutputKey,
  type ChatbotCaptureNodeType,
} from '@core/common/functions/chatbotNodeOutputs';
import { OfficialCapabilitiesResponse } from '@core/schema/chatbot/officialCapabilities/response.schema';
import { OfficialTemplatesResponse } from '@core/schema/chatbot/officialTemplates/response.schema';
import type { UnderchatLookupConfig } from '@core/schema/chatbot/chatbotFlow.schema';
import { useI18n } from 'vue-i18n';
import { useRouter, useRoute } from 'vue-router';
import DialogCloseBtn from '@/@webcore/components/DialogCloseBtn.vue';
import { useChatbotStore } from '@/@webcore/stores/chatbot';
import { useAiAgentStore } from '@/@webcore/stores/aiAgent';
import { getUser } from '@/@webcore/localStorage/user';
import type {
  ChatbotNodePaletteCategory,
  ChatbotNodePaletteItem,
} from '@/types/chatbotNodePalette';
import { createUnderchatVariableCatalog } from '@/utils/underchatVariableCatalog';
import { useChatbotInactivityTargets } from '@/composables/useChatbotInactivityTargets';
import type { ChatbotInactivityRedirectType } from '@/types/chatbotInactivityAlert';
import {
  OFFICIAL_INTERACTIVE_LIMITS,
  findOfficialInteractiveLimitViolation,
} from '@/utils/officialInteractiveLimits';

definePage({
  meta: {
    permissions: [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EChatbotPermissions.chatbot_group,
      EChatbotPermissions.chatbot_access,
    ],
  },
});

const nodeTypes = {
  menu: markRaw(ChatbotMenuNode),
  start: markRaw(ChatbotStartNode),
  satisfaction: markRaw(ChatbotSatisfactionNode),
  redirect: markRaw(ChatbotRedirectNode),
  finish: markRaw(ChatbotFinishNode),
  tag: markRaw(ChatbotTagNode),
  message: markRaw(ChatbotMessageNode),
  data: markRaw(ChatbotDataNode),
  underchat: markRaw(ChatbotUnderchatNode),
  contact: markRaw(ChatbotContactNode),
  aiAgent: markRaw(ChatbotAiAgentNode),
  annotation: markRaw(ChatbotAnnotationNode),
  distribution: markRaw(ChatbotDistributionNode),
  conditional: markRaw(ChatbotConditionalNode),
  randomMessage: markRaw(ChatbotRandomMessageNode),
  weekday: markRaw(ChatbotWeekdayNode),
  hours: markRaw(ChatbotHoursNode),
  holiday: markRaw(ChatbotHolidayNode),
  apiRequest: markRaw(ChatbotApiRequestNode),
  officialReplyButtons: markRaw(ChatbotOfficialNode),
  officialList: markRaw(ChatbotOfficialNode),
  officialCtaUrl: markRaw(ChatbotOfficialNode),
  officialLocationRequest: markRaw(ChatbotOfficialNode),
  officialFlow: markRaw(ChatbotOfficialNode),
  officialSingleProduct: markRaw(ChatbotOfficialNode),
  officialMultiProduct: markRaw(ChatbotOfficialNode),
  officialCatalog: markRaw(ChatbotOfficialNode),
  officialMediaCarousel: markRaw(ChatbotOfficialNode),
  officialAddress: markRaw(ChatbotOfficialNode),
  officialTemplate: markRaw(ChatbotOfficialNode),
  officialLocation: markRaw(ChatbotOfficialNode),
  officialContacts: markRaw(ChatbotOfficialNode),
  officialSticker: markRaw(ChatbotOfficialNode),
  officialReaction: markRaw(ChatbotOfficialNode),
};

const { t } = useI18n();
const router = useRouter();
const route = useRoute();
const chatbotStore = useChatbotStore();
const {
  channels: inactivityChannels,
  chatbots: inactivityChatbots,
  selectedChannelId: inactivityAlertSelectedChannel,
  selectedChatbotId: inactivityAlertSelectedChatbot,
  isLoadingChannels: isLoadingInactivityChannels,
  isLoadingChatbots: isLoadingInactivityChatbots,
  loadChannels: loadInactivityChannels,
  changeChannel: changeInactivityChannel,
  restoreSelection: restoreInactivityChatbotSelection,
} = useChatbotInactivityTargets();
const { width: viewportWidth } = useDisplay();

const aiAgentStore = useAiAgentStore();

const hasFullAccess = computed(() =>
  can([EGeneralPermissions.full_access, EGeneralPermissions.full_access_group])
);

const isMobilePalette = computed(() => viewportWidth.value < 720);
const flowAreaRef = useTemplateRef<HTMLElement>('flowArea');

const nodePaletteStorageKey = computed(() => {
  const user = getUser();
  const accountId = user?.account_id || 'anonymous-account';
  const userId = user?.user_id || 'anonymous-user';

  return `underchat:chatbot-flow:node-palette:v1:${accountId}:${userId}`;
});

const canUseAiAgentPermission = computed(() => {
  return can([
    EGeneralPermissions.full_access,
    EGeneralPermissions.full_access_group,
    EAiAgentPermissions.ai_agent_group,
    EAiAgentPermissions.ai_agent_view,
  ]);
});

const canUseAiAgent = ref(false);

onMounted(async () => {
  if (!canUseAiAgentPermission.value) {
    canUseAiAgent.value = false;
    return;
  }

  const config = await aiAgentStore.fetchAiAgentConfig();
  if (!config?.enabled || !config?.ai_agent || config.ai_agent <= 0) {
    canUseAiAgent.value = false;
    return;
  }

  canUseAiAgent.value = true;
});

const chatbotId = computed(() => {
  const params = route.params as Record<string, string | string[]>;
  const id = (params['id'] || params['chatbot_id']) as string | undefined;
  return id || null;
});

type OfficialNodeType = (typeof OFFICIAL_CHATBOT_NODE_TYPES)[number];

const officialCapabilities = ref<OfficialCapabilitiesResponse | null>(null);
const officialTemplates = ref<OfficialTemplatesResponse>([]);
const isLoadingOfficialTemplates = ref(false);
const officialTemplatesError = ref<string | null>(null);
const canUseOfficialNodes = computed(
  () => officialCapabilities.value?.can_use_official_nodes === true
);

const hasOfficialNodesInCanvas = computed(() =>
  nodes.value.some((node) => isOfficialChatbotNodeType(node.type || ''))
);

const applyOfficialTemplateContextToData = (data: Record<string, any>) => {
  data.availableOfficialTemplates = officialTemplates.value;
  data.isLoadingOfficialTemplates = isLoadingOfficialTemplates.value;
  data.officialTemplatesError = officialTemplatesError.value;
};

const syncOfficialTemplateContextToNodes = () => {
  for (const node of nodes.value) {
    if (node.type !== 'officialTemplate' || !node.data) {
      continue;
    }

    applyOfficialTemplateContextToData(node.data as Record<string, any>);
  }
};

const officialNodeItems: Array<{
  type: OfficialNodeType;
  label: string;
  icon: string;
}> = [
  {
    type: 'officialReplyButtons',
    label: 'Botões oficiais',
    icon: 'tabler-square-rounded-plus',
  },
  {
    type: 'officialList',
    label: 'Lista oficial',
    icon: 'tabler-list',
  },
  { type: 'officialCtaUrl', label: 'CTA URL', icon: 'tabler-external-link' },
  {
    type: 'officialLocationRequest',
    label: 'Solicitar localização',
    icon: 'tabler-current-location',
  },
  { type: 'officialFlow', label: 'Fluxo WhatsApp', icon: 'tabler-sitemap' },
  {
    type: 'officialSingleProduct',
    label: 'Produto único',
    icon: 'tabler-package',
  },
  {
    type: 'officialMultiProduct',
    label: 'Lista de produtos',
    icon: 'tabler-shopping-cart-plus',
  },
  { type: 'officialCatalog', label: 'Catálogo', icon: 'tabler-shopping-cart' },
  {
    type: 'officialMediaCarousel',
    label: 'Carrossel',
    icon: 'tabler-stack-2',
  },
  { type: 'officialAddress', label: 'Endereço', icon: 'tabler-map' },
  {
    type: 'officialTemplate',
    label: 'Template oficial',
    icon: 'tabler-file-description',
  },
  { type: 'officialLocation', label: 'Localização', icon: 'tabler-map-pin' },
  { type: 'officialContacts', label: 'Contatos', icon: 'tabler-address-book' },
  { type: 'officialSticker', label: 'Sticker', icon: 'tabler-note' },
  { type: 'officialReaction', label: 'Reação', icon: 'tabler-mood-smile' },
];

const nodePaletteCategories = computed<ChatbotNodePaletteCategory[]>(() => [
  {
    id: 'conversation',
    label: t('chatbot_palette_conversation'),
    icon: 'tabler-message-circle-2',
  },
  {
    id: 'attendance',
    label: t('chatbot_palette_attendance'),
    icon: 'tabler-route',
  },
  {
    id: 'rules',
    label: t('chatbot_palette_rules'),
    icon: 'tabler-adjustments-code',
  },
  {
    id: 'organization',
    label: t('chatbot_palette_organization'),
    icon: 'tabler-notes',
  },
  {
    id: 'integrations',
    label: t('chatbot_palette_integrations'),
    icon: 'tabler-plug-connected',
  },
  {
    id: 'official',
    label: t('chatbot_palette_official'),
    icon: 'tabler-brand-whatsapp',
  },
]);

const nodePaletteItems = computed<ChatbotNodePaletteItem[]>(() => {
  const items: ChatbotNodePaletteItem[] = [
    {
      id: 'menu',
      category: 'conversation',
      label: t('chatbot_menu'),
      icon: 'tabler-menu-2',
      tone: 'primary',
    },
    {
      id: 'satisfaction',
      category: 'conversation',
      label: t('chatbot_satisfaction'),
      icon: 'tabler-star',
      tone: 'warning',
    },
    {
      id: 'message',
      category: 'conversation',
      label: t('chatbot_message'),
      icon: 'tabler-message',
      tone: 'primary',
    },
    {
      id: 'randomMessage',
      category: 'conversation',
      label: t('chatbot_random_message'),
      icon: 'tabler-message-2',
      tone: 'randomMessage',
    },
    {
      id: 'redirect',
      category: 'attendance',
      label: t('chatbot_redirect'),
      icon: 'tabler-arrow-forward',
      tone: 'info',
    },
    {
      id: 'distribution',
      category: 'attendance',
      label: t('chatbot_distribution'),
      icon: 'tabler-users-group',
      tone: 'distribution',
    },
    {
      id: 'contact',
      category: 'attendance',
      label: t('chatbot_contact'),
      icon: 'tabler-users',
      tone: 'tertiary',
    },
    {
      id: 'tag',
      category: 'attendance',
      label: t('chatbot_tag_node_title'),
      icon: 'tabler-tag',
      tone: 'secondary',
    },
    {
      id: 'finish',
      category: 'attendance',
      label: t('chatbot_finish'),
      icon: 'tabler-circle-check',
      tone: 'error',
    },
    {
      id: 'data',
      category: 'rules',
      label: t('chatbot_data'),
      icon: 'tabler-database',
      tone: 'info',
    },
    {
      id: 'conditional',
      category: 'rules',
      label: t('chatbot_conditional'),
      icon: 'tabler-code',
      tone: 'warning',
    },
    {
      id: 'weekday',
      category: 'rules',
      label: t('chatbot_weekday'),
      icon: 'tabler-calendar',
      tone: 'primary',
    },
    {
      id: 'hours',
      category: 'rules',
      label: t('chatbot_hours'),
      icon: 'tabler-clock-hour-3',
      tone: 'warning',
    },
    {
      id: 'holiday',
      category: 'rules',
      label: t('chatbot_holidays'),
      icon: 'tabler-calendar-star',
      tone: 'primary',
    },
    {
      id: 'annotation',
      category: 'organization',
      label: t('chatbot_annotation_node_title'),
      icon: 'tabler-note',
      tone: 'annotation',
    },
    {
      id: 'apiRequest',
      category: 'integrations',
      label: t('chatbot_api_request'),
      icon: 'tabler-api',
      tone: 'info',
    },
  ];

  if (hasFullAccess.value) {
    items.push({
      id: 'underchat',
      category: 'integrations',
      label: t('chatbot_underchat'),
      icon: 'tabler-user-search',
      tone: 'info',
    });
  }

  if (canUseAiAgentPermission.value && canUseAiAgent.value) {
    items.splice(7, 0, {
      id: 'aiAgent',
      category: 'attendance',
      label: t('chatbot_ai_agent'),
      icon: 'tabler-brain',
      tone: 'primary',
    });
  }

  if (canUseOfficialNodes.value) {
    items.push(
      ...officialNodeItems.map((item) => ({
        id: item.type,
        category: 'official' as const,
        label: item.label,
        icon: item.icon,
        tone: 'success' as const,
      }))
    );
  }

  return items;
});

const isConfigModalOpen = ref(false);
const inactivityAlertStatus = ref<'active' | 'inactive'>('inactive');
const inactivityAlertQuantity = ref('');
const inactivityAlertTime = ref('');
const inactivityAlertAction = ref<'redirect' | 'finish' | null>(null);
const inactivityAlertRedirectType = ref<ChatbotInactivityRedirectType | null>(
  null
);
const inactivityAlertSelectedUser = ref<string | null>(null);
const inactivityAlertSelectedSector = ref<string | null>(null);
const inactivityAlertSelectedSectorUser = ref<string | null>(null);

const redirectFailedAttemptsStatus = ref<'active' | 'inactive'>('inactive');
const redirectFailedAttemptsQuantity = ref('');
const redirectFailedAttemptsRedirectType = ref<'user' | 'sector' | null>(null);
const redirectFailedAttemptsSelectedUser = ref<string | null>(null);
const redirectFailedAttemptsSelectedSector = ref<string | null>(null);
const redirectFailedAttemptsSelectedSectorUser = ref<string | null>(null);

type TriggerEventKey = 'text' | 'audio' | 'attachments' | 'reactions' | 'gifs';

const DEFAULT_TRIGGER_EVENTS: TriggerEventKey[] = [
  'text',
  'audio',
  'attachments',
  'reactions',
  'gifs',
];
const VALID_TRIGGER_EVENTS = new Set<TriggerEventKey>(DEFAULT_TRIGGER_EVENTS);

const finishTriggers = ref<string[]>([]);
const finishTriggerInput = ref('');
const triggerEvents = ref<TriggerEventKey[]>([...DEFAULT_TRIGGER_EVENTS]);

const inactivityUsers = ref<any[]>([]);
const inactivitySectors = ref<any[]>([]);
const inactivitySectorUsers = ref<any[]>([]);
const isLoadingInactivityUsers = ref(false);
const isLoadingInactivitySectors = ref(false);
const isLoadingInactivitySectorUsers = ref(false);

const redirectFailedAttemptsUsers = ref<any[]>([]);
const redirectFailedAttemptsSectors = ref<any[]>([]);
const redirectFailedAttemptsSectorUsers = ref<any[]>([]);
const isLoadingRedirectFailedAttemptsUsers = ref(false);
const isLoadingRedirectFailedAttemptsSectors = ref(false);
const isLoadingRedirectFailedAttemptsSectorUsers = ref(false);

const configTab = ref('resources');
const isVariablesSidebarOpen = ref(false);
const isSavingConfigurations = ref(false);
const isLoadingConfigurations = ref(false);

const defaultInactivityMessage = computed(() =>
  t('chatbot_inactivity_message_default')
);
const defaultInvalidMenuOptionMessage = computed(() =>
  t('chatbot_option_invalid')
);
const defaultInvalidSatisfactionOptionMessage = computed(() =>
  t('chatbot_satisfaction_option_invalid')
);
const defaultInvalidCpfMessage = computed(() => t('cpf_invalid'));
const defaultInvalidCnpjMessage = computed(() => t('cnpj_invalid'));
const defaultInvalidEmailMessage = computed(() => t('email_invalid'));
const defaultServiceFinishedMessage = computed(() =>
  t('chatbot_service_finished')
);
const defaultTransferMessageUserText = ref('');
const defaultTransferMessageSectorText = ref('');
const defaultTransferMessageSectorUserText = ref('');

const safeDefaultTransferMessageUserText = computed(() => {
  return defaultTransferMessageUserText.value || '';
});
const safeDefaultTransferMessageSectorText = computed(() => {
  return defaultTransferMessageSectorText.value || '';
});
const safeDefaultTransferMessageSectorUserText = computed(() => {
  return defaultTransferMessageSectorUserText.value || '';
});

const availableVariables = computed(() => createUnderchatVariableCatalog(t));

const inactivityMessage = ref('');
const invalidMenuOptionMessage = ref('');
const invalidSatisfactionOptionMessage = ref('');
const invalidCpfMessage = ref('');
const invalidCnpjMessage = ref('');
const invalidEmailMessage = ref('');
const serviceFinishedMessage = ref('');
const transferMessageUser = ref('');
const transferMessageSector = ref('');
const transferMessageSectorUser = ref('');

const isInactivityMessageEnabled = ref(true);
const isInvalidMenuOptionMessageEnabled = ref(true);
const isInvalidSatisfactionOptionMessageEnabled = ref(true);
const isInvalidCpfMessageEnabled = ref(true);
const isInvalidCnpjMessageEnabled = ref(true);
const isInvalidEmailMessageEnabled = ref(true);
const isServiceFinishedMessageEnabled = ref(true);
const isTransferMessageUserEnabled = ref(true);
const isTransferMessageSectorEnabled = ref(true);
const isTransferMessageSectorUserEnabled = ref(true);

const onlyDigits = (s: string) => s.replaceAll(/\D+/g, '');

const redirectFailedAttemptsQuantityComputed = computed({
  get: () => redirectFailedAttemptsQuantity.value,
  set: (value: string) => {
    redirectFailedAttemptsQuantity.value = onlyDigits(value);
  },
});

const isInactivityChatbotTargetIncomplete = computed(
  () =>
    inactivityAlertStatus.value === 'active' &&
    inactivityAlertAction.value === 'redirect' &&
    inactivityAlertRedirectType.value === 'chatbot' &&
    (!inactivityAlertSelectedChannel.value ||
      !inactivityAlertSelectedChatbot.value)
);

const isPositiveIntegerInput = (value: string): boolean =>
  /^[1-9]\d*$/u.test(value);

const isInactivityAlertQuantityInvalid = computed(
  () =>
    inactivityAlertStatus.value === 'active' &&
    !isPositiveIntegerInput(inactivityAlertQuantity.value)
);

const isInactivityAlertTimeInvalid = computed(
  () =>
    inactivityAlertStatus.value === 'active' &&
    !isPositiveIntegerInput(inactivityAlertTime.value)
);

const inactivityAlertQuantityError = computed(() =>
  isInactivityAlertQuantityInvalid.value
    ? t('chatbot_flow_validation_inactivity_quantity_required')
    : null
);

const inactivityAlertTimeError = computed(() =>
  isInactivityAlertTimeInvalid.value
    ? t('chatbot_flow_validation_inactivity_time_required')
    : null
);

const isInactivityAlertConfigurationIncomplete = computed(
  () =>
    isInactivityAlertQuantityInvalid.value ||
    isInactivityAlertTimeInvalid.value ||
    isInactivityChatbotTargetIncomplete.value
);

const showRedirectFailedAttemptsFields = computed(
  () => redirectFailedAttemptsStatus.value === 'active'
);

const showRedirectFailedAttemptsRedirectFields = computed(
  () =>
    showRedirectFailedAttemptsFields.value &&
    redirectFailedAttemptsRedirectType.value !== null
);

const showRedirectFailedAttemptsUserField = computed(
  () =>
    showRedirectFailedAttemptsRedirectFields.value &&
    redirectFailedAttemptsRedirectType.value === 'user'
);

const showRedirectFailedAttemptsSectorField = computed(
  () =>
    showRedirectFailedAttemptsRedirectFields.value &&
    redirectFailedAttemptsRedirectType.value === 'sector'
);

const showRedirectFailedAttemptsSectorUserField = computed(
  () =>
    showRedirectFailedAttemptsSectorField.value &&
    redirectFailedAttemptsSelectedSector.value !== null
);

const triggerEventOptions = computed(() => [
  { value: 'text' as const, label: t('chatbot_trigger_event_text') },
  { value: 'audio' as const, label: t('chatbot_trigger_event_audio') },
  {
    value: 'attachments' as const,
    label: t('chatbot_trigger_event_attachments'),
  },
  { value: 'reactions' as const, label: t('chatbot_trigger_event_reactions') },
  { value: 'gifs' as const, label: t('chatbot_trigger_event_gifs') },
]);

const normalizeTriggerEvents = (value: unknown): TriggerEventKey[] => {
  if (value === undefined || value === null) {
    return [...DEFAULT_TRIGGER_EVENTS];
  }

  if (!Array.isArray(value)) {
    return [...DEFAULT_TRIGGER_EVENTS];
  }

  if (value.length === 0) {
    return [];
  }

  return value.filter(
    (event): event is TriggerEventKey =>
      typeof event === 'string' &&
      VALID_TRIGGER_EVENTS.has(event as TriggerEventKey)
  );
};

const onKeyPress = (event: KeyboardEvent) => {
  const char = event.key;
  if (
    !/\d/.test(char) &&
    ![
      'Backspace',
      'Delete',
      'ArrowLeft',
      'ArrowRight',
      'Tab',
      'Enter',
    ].includes(char)
  ) {
    event.preventDefault();
  }
};

const loadInactivityUsers = async () => {
  const user = getUser();
  if (!user?.account_id) return;

  isLoadingInactivityUsers.value = true;
  try {
    const usersList = await chatbotStore.listChatbotUsers();
    inactivityUsers.value = usersList.map((user) => ({
      value: user.id,
      title: user.name,
      photo: user.photo || null,
      status: user.status || null,
    }));
  } catch (error) {
    console.error('Error loading users:', error);
  } finally {
    isLoadingInactivityUsers.value = false;
  }
};

const loadInactivitySectors = async () => {
  const user = getUser();
  if (!user?.account_id) return;

  isLoadingInactivitySectors.value = true;
  try {
    const sectorsList = await chatbotStore.listChatbotSectors();
    inactivitySectors.value = sectorsList.map((sector) => ({
      value: sector.id,
      title: sector.name,
      color: sector.color || null,
    }));
  } catch (error) {
    console.error('Error loading sectors:', error);
  } finally {
    isLoadingInactivitySectors.value = false;
  }
};

const loadInactivitySectorUsers = async (sectorId: string) => {
  isLoadingInactivitySectorUsers.value = true;
  try {
    const usersList = await chatbotStore.listChatbotSectorUsers(sectorId);
    inactivitySectorUsers.value = usersList.map((user) => ({
      value: user.id,
      title: user.name,
      photo: user.photo || null,
      status: user.status,
    }));
  } catch (error) {
    inactivitySectorUsers.value = [];
    console.error('Error loading sector users:', error);
  } finally {
    isLoadingInactivitySectorUsers.value = false;
  }
};

const handleInactivityChannelChange = async (
  workerId: string | null
): Promise<void> => {
  await changeInactivityChannel(workerId);
};

const loadRedirectFailedAttemptsUsers = async () => {
  const user = getUser();
  if (!user?.account_id) return;

  isLoadingRedirectFailedAttemptsUsers.value = true;
  try {
    const usersList = await chatbotStore.listChatbotUsers();
    redirectFailedAttemptsUsers.value = usersList.map((user) => ({
      value: user.id,
      title: user.name,
      photo: user.photo || null,
      status: user.status || null,
    }));
  } catch (error) {
    console.error('Error loading users:', error);
  } finally {
    isLoadingRedirectFailedAttemptsUsers.value = false;
  }
};

const loadRedirectFailedAttemptsSectors = async () => {
  const user = getUser();
  if (!user?.account_id) return;

  isLoadingRedirectFailedAttemptsSectors.value = true;
  try {
    const sectorsList = await chatbotStore.listChatbotSectors();
    redirectFailedAttemptsSectors.value = sectorsList.map((sector) => ({
      value: sector.id,
      title: sector.name,
      color: sector.color || null,
    }));
  } catch (error) {
    console.error('Error loading sectors:', error);
  } finally {
    isLoadingRedirectFailedAttemptsSectors.value = false;
  }
};

const loadRedirectFailedAttemptsSectorUsers = async (sectorId: string) => {
  isLoadingRedirectFailedAttemptsSectorUsers.value = true;
  try {
    const usersList = await chatbotStore.listChatbotSectorUsers(sectorId);
    redirectFailedAttemptsSectorUsers.value = usersList.map((user) => ({
      value: user.id,
      title: user.name,
      photo: user.photo || null,
      status: user.status,
    }));
  } catch (error) {
    redirectFailedAttemptsSectorUsers.value = [];
    console.error('Error loading sector users:', error);
  } finally {
    isLoadingRedirectFailedAttemptsSectorUsers.value = false;
  }
};

watch(
  () => inactivityAlertSelectedSector.value,
  (newSectorId) => {
    if (newSectorId) {
      inactivityAlertSelectedSectorUser.value = null;
      loadInactivitySectorUsers(newSectorId);
    } else {
      inactivitySectorUsers.value = [];
      inactivityAlertSelectedSectorUser.value = null;
    }
  }
);

watch(
  () => redirectFailedAttemptsSelectedSector.value,
  (newSectorId) => {
    if (newSectorId) {
      redirectFailedAttemptsSelectedSectorUser.value = null;
      loadRedirectFailedAttemptsSectorUsers(newSectorId);
    } else {
      redirectFailedAttemptsSectorUsers.value = [];
      redirectFailedAttemptsSelectedSectorUser.value = null;
    }
  }
);

const openConfigModal = async () => {
  if (isFlowReadOnly.value) return;
  isConfigModalOpen.value = true;
  try {
    isLoadingConfigurations.value = true;
    await loadChatbotFlowConfigurations();
  } finally {
    isLoadingConfigurations.value = false;
  }
};

const closeConfigModal = () => {
  isConfigModalOpen.value = false;
};

const initialNodes: Node[] = [
  {
    id: '1',
    type: 'start',
    label: t('chatbot_start'),
    position: { x: 250, y: 5 },
    draggable: false,
    data: {},
  },
];

const initialEdges: Edge[] = [];

const nodes = ref<Node[]>(initialNodes);
const edges = ref<Edge[]>(initialEdges);
const isFlowReadOnly = ref(false);
const apiUpstreamContractSignatures = new Map<string, string>();
const reservedApiOutputKeys = new Set<string>();
const reservedNodeOutputKeys: Record<ChatbotCaptureNodeType, Set<string>> = {
  data: new Set<string>(),
  message: new Set<string>(),
  underchat: new Set<string>(),
};
const VARIABLE_CONSUMER_NODE_TYPES = new Set([
  'menu',
  'satisfaction',
  'message',
  'data',
  'underchat',
  'conditional',
  'holiday',
  'annotation',
  'officialTemplate',
]);

const RUNTIME_NODE_DATA_KEYS = new Set([
  'attachmentFile',
  'availableOfficialTemplates',
  'availableVariables',
  'isLoadingOfficialTemplates',
  'officialTemplatesError',
  'onRemove',
  'onRemoveCondition',
  'onRemoveInteractionsEdge',
  'onRemoveOption',
  'onTest',
  'onUpdate',
  'readOnly',
  'restricted',
  'upstreamContracts',
]);

const toSerializableValue = (value: unknown): unknown => {
  if (typeof value === 'function' || value === undefined) return undefined;
  if (typeof File !== 'undefined' && value instanceof File) return undefined;
  if (Array.isArray(value)) {
    return value
      .map((entry) => toSerializableValue(entry))
      .filter((entry) => entry !== undefined);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !RUNTIME_NODE_DATA_KEYS.has(key))
        .map(([key, entry]) => [key, toSerializableValue(entry)])
        .filter(([, entry]) => entry !== undefined)
    );
  }
  return value;
};

const toSerializableNodeData = (
  data: Record<string, unknown> | undefined
): Record<string, any> =>
  (toSerializableValue(data || {}) as Record<string, any>) || {};

const getGraphFlow = () => ({
  chatbot_id: chatbotId.value || '',
  nodes: nodes.value.map((node) => ({
    id: node.id,
    type: node.type || '',
    position: { x: node.position.x, y: node.position.y },
    data: toSerializableNodeData(node.data as Record<string, unknown>),
  })),
  edges: edges.value.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ? String(edge.sourceHandle) : undefined,
    targetHandle: edge.targetHandle ? String(edge.targetHandle) : undefined,
  })),
});

const isCapturedApiField = (
  config: ApiRequestConfig,
  path: string
): boolean => {
  if (config.capture.mode === 'full') return true;
  return config.capture.paths.some(
    (selectedPath) =>
      path === selectedPath || path.startsWith(`${selectedPath}.`)
  );
};

const getVariablesForNode = (nodeId: string): ApiRequestVariable[] => {
  const globalVariables: ApiRequestVariable[] = availableVariables.value.map(
    (variable) => ({
      ...variable,
      label: variable.tag,
      type: 'string',
    })
  );
  const graph = getGraphFlow();
  const dominators =
    computeChatbotFlowDominators(graph as any).get(nodeId) ?? new Set<string>();
  const upstreamVariables: ApiRequestVariable[] = [];

  for (const node of graph.nodes) {
    if (node.id === nodeId) continue;

    const capturedOutput = getChatbotNodeOutputDefinition(node);
    if (
      capturedOutput &&
      isChatbotNodeOutputAvailableAtNode(
        graph as any,
        node.id,
        nodeId,
        capturedOutput.sourceHandle
      )
    ) {
      for (const field of capturedOutput.fields) {
        const descriptionKey =
          capturedOutput.nodeType === 'data'
            ? 'chatbot_captured_output_data_help'
            : capturedOutput.nodeType === 'underchat'
              ? 'chatbot_underchat_output_description'
              : 'chatbot_captured_output_message_help';
        upstreamVariables.push({
          tag: formatChatbotNodeOutputTag(capturedOutput.outputKey, field.path),
          label: `${capturedOutput.outputKey} · ${field.path}`,
          description: t(descriptionKey),
          type: field.type,
          sourceNodeId: node.id,
        });
      }
    }

    if (!dominators.has(node.id)) continue;
    if (node.type !== 'apiRequest') continue;

    const config = node.data.apiRequest as ApiRequestConfig | undefined;
    if (!config || config.test.state !== 'tested' || !config.test.evidence) {
      continue;
    }
    const source = config.outputKey;
    upstreamVariables.push(
      {
        tag: formatApiVariableTag(source),
        label: `${source} · resposta`,
        description: 'Corpo capturado da chamada de API.',
        type: 'object',
        sourceNodeId: node.id,
      },
      {
        tag: formatApiVariableTag(source, '_response.status'),
        label: `${source} · status HTTP`,
        description: 'Código de status retornado pelo endpoint.',
        type: 'number',
        sourceNodeId: node.id,
      }
    );

    for (const field of config.capture.contract) {
      if (!isCapturedApiField(config, field.path)) continue;
      upstreamVariables.push({
        tag: formatApiVariableTag(source, field.path),
        label: field.path,
        description: field.projectedFromArray
          ? `${source} · projeção de array`
          : `${source} · ${field.type}`,
        type: field.type,
        sourceNodeId: node.id,
      });
    }

    for (const header of config.capture.responseHeaders) {
      upstreamVariables.push({
        tag: formatApiVariableTag(source, `_response.headers.${header}`),
        label: `${source} · ${header}`,
        description: 'Header capturado da resposta.',
        type: 'string',
        sourceNodeId: node.id,
      });
    }
  }

  return [...globalVariables, ...upstreamVariables].filter(
    (variable, index, catalog) =>
      catalog.findIndex((candidate) => candidate.tag === variable.tag) === index
  );
};

const getApiUpstreamContracts = (nodeId: string): Record<string, unknown> =>
  getUpstreamApiContracts(getGraphFlow() as any, nodeId);

const testApiRequestNode = async (
  input: ApiRequestTestInput
): Promise<ApiRequestTestResult> => {
  if (!chatbotId.value) {
    throw new Error('ChatBot não identificado para executar o teste.');
  }

  return chatbotStore.testChatbotApiRequest({
    chatbot_id: chatbotId.value,
    node_id: input.nodeId,
    configuration: input.config,
    sample_variables: input.sampleVariables,
    upstream_contracts:
      input.upstreamContracts ?? getApiUpstreamContracts(input.nodeId),
    confirm_side_effects: input.confirmSideEffects,
  });
};

const updateApiRequestNode = (
  nodeId: string,
  config: ApiRequestConfig
): void => {
  const node = nodes.value.find((candidate) => candidate.id === nodeId);
  if (!node?.data) return;
  node.data.apiRequest = normalizeApiRequestConfig(config, {
    outputKey: config.outputKey,
  });
};

const applyApiRequestRuntimeData = (node: Node): void => {
  if (node.type !== 'apiRequest') return;
  if (!node.data) node.data = {};
  node.data.availableVariables = getVariablesForNode(node.id);
  node.data.upstreamContracts = getApiUpstreamContracts(node.id);
  node.data.onUpdate = (config: ApiRequestConfig) =>
    updateApiRequestNode(node.id, config);
  node.data.onTest = testApiRequestNode;
};

const updateUnderchatNode = (
  nodeId: string,
  underchatLookup: UnderchatLookupConfig
): void => {
  if (isFlowReadOnly.value || !hasFullAccess.value) return;
  const node = nodes.value.find((candidate) => candidate.id === nodeId);
  if (!node?.data || node.type !== 'underchat') return;
  node.data.underchatLookup = { ...underchatLookup, version: 1 };
};

const applyUnderchatRuntimeData = (node: Node): void => {
  if (node.type !== 'underchat') return;
  if (!node.data) node.data = {};

  const restricted = node.data.restricted === true || !hasFullAccess.value;
  const readOnly = isFlowReadOnly.value || restricted;
  node.data.restricted = restricted;
  node.data.readOnly = readOnly;
  node.data.availableVariables = restricted ? [] : getVariablesForNode(node.id);
  node.data.onUpdate = readOnly
    ? undefined
    : (lookup: UnderchatLookupConfig) => updateUnderchatNode(node.id, lookup);
  if (readOnly) delete node.data.onRemove;
};

const syncRuntimeVariableCatalogs = (): void => {
  for (const node of nodes.value) {
    if (!node.data) node.data = {};
    if (node.type === 'apiRequest') {
      applyApiRequestRuntimeData(node);
      const upstreamSignature = JSON.stringify(
        node.data.upstreamContracts || {}
      );
      const previousSignature = apiUpstreamContractSignatures.get(node.id);
      const config = node.data.apiRequest as ApiRequestConfig | undefined;
      if (
        previousSignature !== undefined &&
        previousSignature !== upstreamSignature &&
        config?.test.evidence
      ) {
        node.data.apiRequest = markApiRequestChanged(config);
      }
      apiUpstreamContractSignatures.set(node.id, upstreamSignature);
      continue;
    }
    if (node.type === 'underchat') {
      applyUnderchatRuntimeData(node);
      continue;
    }
    if (node.type && VARIABLE_CONSUMER_NODE_TYPES.has(node.type)) {
      node.data.availableVariables = getVariablesForNode(node.id);
    }
  }
  const currentNodeIds = new Set(nodes.value.map((node) => node.id));
  for (const nodeId of apiUpstreamContractSignatures.keys()) {
    if (!currentNodeIds.has(nodeId))
      apiUpstreamContractSignatures.delete(nodeId);
  }
};

const apiGraphSignature = computed<string>(() => {
  const apiNodes: Array<{ id: string; config: unknown }> = [];
  const capturedOutputNodes: Array<{ id: string; config: unknown }> = [];
  const consumers: string[] = [];
  for (const node of nodes.value as Node[]) {
    if (node.type === 'apiRequest') {
      const config = node.data?.apiRequest as ApiRequestConfig | undefined;
      apiNodes.push({
        id: node.id,
        config: config
          ? {
              outputKey: config.outputKey,
              capture: config.capture,
              testState: config.test.state,
              hasEvidence: Boolean(config.test.evidence),
            }
          : null,
      });
    }
    if (isChatbotCaptureNodeType(node.type)) {
      capturedOutputNodes.push({
        id: node.id,
        config: {
          type: node.type,
          outputKey: node.data?.outputKey,
          dataType: node.data?.dataType,
          continueType: node.data?.continueType,
          underchatLookup: node.data?.underchatLookup,
        },
      });
    }
    if (node.type && VARIABLE_CONSUMER_NODE_TYPES.has(node.type)) {
      consumers.push(node.id);
    }
  }
  const edgeSignature: Array<[string, string, string | null, string | null]> =
    edges.value.map((edge) => [
      edge.source,
      edge.target,
      edge.sourceHandle ? String(edge.sourceHandle) : null,
      edge.targetHandle ? String(edge.targetHandle) : null,
    ]);

  return JSON.stringify({
    globals: availableVariables.value,
    apiNodes,
    capturedOutputNodes,
    consumers,
    edges: edgeSignature,
  });
});

watch(apiGraphSignature, syncRuntimeVariableCatalogs, { immediate: true });

const selectedEdgeId = ref<string | null>(null);
const contextMenuPosition = ref<{ x: number; y: number } | null>(null);
const isContextMenuOpen = ref(false);
const contextMenuEdgeId = ref<string | null>(null);
const contextMenuCard = ref<HTMLElement | null>(null);

let nodeIdCounter = 2;
const allocateApiOutputKey = (): string => {
  const outputKey = getNextApiOutputKey([...reservedApiOutputKeys]);
  reservedApiOutputKeys.add(outputKey);
  return outputKey;
};
const allocateNodeOutputKey = (type: ChatbotCaptureNodeType): string => {
  const outputKey = getNextChatbotNodeOutputKey(type, [
    ...reservedNodeOutputKeys[type],
  ]);
  reservedNodeOutputKeys[type].add(outputKey);
  return outputKey;
};
const optionNodeTypes = new Set([
  'menu',
  'satisfaction',
  'contact',
  'weekday',
  'hours',
  'holiday',
]);

type WeekdayOptionId =
  | 'sunday'
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday';

interface WeekdayOption {
  id: WeekdayOptionId;
  text: string;
  required: boolean;
}

interface HoursOption {
  id: string;
  text: string;
  required: boolean;
  start_time?: string;
  end_time?: string;
}

const WEEKDAY_NODE_DEFAULT_TIMEZONE = 'America/Sao_Paulo';
const HOURS_NODE_DEFAULT_TIMEZONE = 'America/Sao_Paulo';
const HOURS_OUTSIDE_OPTION_ID = 'outside-hours';
const HOLIDAY_IS_OPTION_ID = 'is-holiday';
const HOLIDAY_NOT_OPTION_ID = 'not-holiday';
const HOURS_DEFAULT_START_TIME = '09:00';
const HOURS_DEFAULT_END_TIME = '18:00';
const HOURS_TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;
const WEEKDAY_OPTION_IDS: WeekdayOptionId[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

const getWeekdayOptionText = (weekdayId: WeekdayOptionId): string => {
  switch (weekdayId) {
    case 'monday':
      return t('monday');
    case 'tuesday':
      return t('tuesday');
    case 'wednesday':
      return t('wednesday');
    case 'thursday':
      return t('thursday');
    case 'friday':
      return t('friday');
    case 'saturday':
      return t('saturday');
    default:
      return t('sunday');
  }
};

const buildWeekdayOptions = (
  existingOptions?: Array<{ id?: string; text?: string; required?: boolean }>
): WeekdayOption[] => {
  const optionsById = new Map<WeekdayOptionId, { text?: string }>();

  for (const option of existingOptions || []) {
    const optionId = option?.id;
    if (!optionId) {
      continue;
    }

    if (WEEKDAY_OPTION_IDS.includes(optionId as WeekdayOptionId)) {
      optionsById.set(optionId as WeekdayOptionId, option);
    }
  }

  return WEEKDAY_OPTION_IDS.map((weekdayId) => {
    const existing = optionsById.get(weekdayId);
    return {
      id: weekdayId,
      text: existing?.text || getWeekdayOptionText(weekdayId),
      required: true,
    };
  });
};

const isValidHoursTime = (value?: string): boolean => {
  return typeof value === 'string' && HOURS_TIME_REGEX.test(value);
};

const normalizeHoursIntervalOption = (
  option?: Partial<HoursOption>
): HoursOption => {
  const normalizedId =
    typeof option?.id === 'string' && option.id.trim().length > 0
      ? option.id.trim().replace(/^option-/i, '')
      : crypto.randomUUID();

  const startTime = isValidHoursTime(option?.start_time)
    ? option?.start_time
    : HOURS_DEFAULT_START_TIME;
  const endTime = isValidHoursTime(option?.end_time)
    ? option?.end_time
    : HOURS_DEFAULT_END_TIME;

  const text =
    typeof option?.text === 'string' && option.text.trim().length > 0
      ? option.text
      : `${startTime} -> ${endTime}`;

  return {
    id: normalizedId,
    text,
    required: false,
    start_time: startTime,
    end_time: endTime,
  };
};

const buildHoursOptions = (
  existingOptions?: Array<{
    id?: string;
    text?: string;
    required?: boolean;
    start_time?: string;
    end_time?: string;
  }>
): HoursOption[] => {
  const intervalOptions: HoursOption[] = [];
  let outsideHoursText = t('chatbot_hours_outside_hours');

  for (const option of existingOptions || []) {
    const optionId =
      typeof option?.id === 'string'
        ? option.id.trim().replace(/^option-/i, '')
        : '';

    if (!optionId) {
      continue;
    }

    if (optionId === HOURS_OUTSIDE_OPTION_ID) {
      if (typeof option.text === 'string' && option.text.trim().length > 0) {
        outsideHoursText = option.text;
      }
      continue;
    }

    intervalOptions.push(
      normalizeHoursIntervalOption({
        ...option,
        id: optionId,
      })
    );
  }

  if (intervalOptions.length === 0) {
    intervalOptions.push(
      normalizeHoursIntervalOption({
        id: crypto.randomUUID(),
        text: `${HOURS_DEFAULT_START_TIME} -> ${HOURS_DEFAULT_END_TIME}`,
        start_time: HOURS_DEFAULT_START_TIME,
        end_time: HOURS_DEFAULT_END_TIME,
      })
    );
  }

  return [
    ...intervalOptions,
    {
      id: HOURS_OUTSIDE_OPTION_ID,
      text: outsideHoursText,
      required: true,
    },
  ];
};

const normalizeHandleId = (handle?: string | null): string | null => {
  if (!handle) {
    return null;
  }

  const normalized = handle
    .toString()
    .trim()
    .replace(/^option-/i, '')
    .replace(/-source$/i, '');

  return normalized || null;
};

const buildNormalizedOptionHandle = (
  handle?: string | null
): string | undefined => {
  const normalized = normalizeHandleId(handle);
  return normalized ? `option-${normalized}-source` : undefined;
};

const normalizeEdgeSourceHandle = (edge: Edge): string | undefined => {
  const sourceNode = nodes.value.find((n) => n.id === edge.source) as
    Node | undefined;
  const nodeType = sourceNode?.type as string | undefined;
  const shouldNormalize = nodeType && optionNodeTypes.has(nodeType);

  if (shouldNormalize) {
    return (
      buildNormalizedOptionHandle(
        edge.sourceHandle ? String(edge.sourceHandle) : undefined
      ) || undefined
    );
  }

  return edge.sourceHandle ? String(edge.sourceHandle) : undefined;
};

const normalizeEdge = (edge: Edge): Edge => {
  const normalizedSourceHandle = normalizeEdgeSourceHandle(edge);

  const normalizedEdge: Edge = {
    ...edge,
    sourceHandle: normalizedSourceHandle,
    targetHandle: edge.targetHandle ? String(edge.targetHandle) : undefined,
  };

  return normalizedEdge;
};

const normalizeConnectionSourceHandle = (
  connection: Connection
): string | undefined => {
  const sourceNode = nodes.value.find((n) => n.id === connection.source) as
    Node | undefined;
  const nodeType = sourceNode?.type as string | undefined;
  const shouldNormalize = nodeType && optionNodeTypes.has(nodeType);

  if (shouldNormalize) {
    return (
      buildNormalizedOptionHandle(
        connection.sourceHandle ? String(connection.sourceHandle) : undefined
      ) || undefined
    );
  }

  return connection.sourceHandle ? String(connection.sourceHandle) : undefined;
};

const getSecureRandom = (max: number, min = 0): number => {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return (array[0] / (0xffffffff + 1)) * (max - min) + min;
};

const removeNode = (nodeId: string) => {
  if (isFlowReadOnly.value) return;
  const nodeIndex = nodes.value.findIndex((n) => n.id === nodeId);
  if (nodeIndex > -1) {
    nodes.value.splice(nodeIndex, 1);
  }

  edges.value = edges.value.filter(
    (e) => e.source !== nodeId && e.target !== nodeId
  );
};

const removeEdge = (edgeId: string) => {
  if (isFlowReadOnly.value) return;
  const edgeIndex = edges.value.findIndex((e) => e.id === edgeId);
  if (edgeIndex > -1) {
    edges.value.splice(edgeIndex, 1);
  }
  selectedEdgeId.value = null;
};

const handleRemoveEdge = (event?: MouseEvent | KeyboardEvent) => {
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }

  if (isFlowReadOnly.value) return;

  const edgeIdToRemove = contextMenuEdgeId.value || selectedEdgeId.value;

  if (!edgeIdToRemove) {
    isContextMenuOpen.value = false;
    contextMenuPosition.value = null;
    return;
  }

  const edgeIndex = edges.value.findIndex((e) => e.id === edgeIdToRemove);
  if (edgeIndex > -1) {
    edges.value.splice(edgeIndex, 1);
  }

  selectedEdgeId.value = null;
  contextMenuEdgeId.value = null;
  isContextMenuOpen.value = false;
  contextMenuPosition.value = null;
};

const onEdgeClick = (event: { edge: Edge }) => {
  for (const edge of edges.value) {
    (edge as any).selected = edge.id === event.edge.id;
  }
  selectedEdgeId.value = event.edge.id;
};

const onEdgeContextMenu = (event: any) => {
  const mouseEvent = event.event as MouseEvent;
  mouseEvent.preventDefault();
  mouseEvent.stopPropagation();
  if (isFlowReadOnly.value) return;
  for (const edge of edges.value) {
    (edge as any).selected = edge.id === event.edge.id;
  }
  selectedEdgeId.value = event.edge.id;
  contextMenuEdgeId.value = event.edge.id;
  contextMenuPosition.value = {
    x: mouseEvent.clientX,
    y: mouseEvent.clientY,
  };
  nextTick(() => {
    isContextMenuOpen.value = true;
  });
};

watch(isContextMenuOpen, (newValue) => {
  if (!newValue) {
    contextMenuPosition.value = null;
    contextMenuEdgeId.value = null;
  }
});

const onPaneClick = () => {
  for (const edge of edges.value) {
    (edge as any).selected = false;
  }
  selectedEdgeId.value = null;
  isContextMenuOpen.value = false;
};

const handleDeleteKey = (event: KeyboardEvent) => {
  if (isFlowReadOnly.value) return;
  if (event.key === 'Delete' || event.key === 'Backspace') {
    if (selectedEdgeId.value) {
      removeEdge(selectedEdgeId.value);
      event.preventDefault();
    }
  }
};

const removeOptionEdge = (nodeId: string, optionId: string) => {
  if (isFlowReadOnly.value) return;
  const sourceHandle = `option-${optionId}-source`;
  edges.value = edges.value.filter(
    (e) => !(e.source === nodeId && e.sourceHandle === sourceHandle)
  );
};

const removeConditionEdge = (nodeId: string, conditionId: string) => {
  if (isFlowReadOnly.value) return;
  const sourceHandle = `condition-${conditionId}-source`;
  edges.value = edges.value.filter(
    (e) => !(e.source === nodeId && e.sourceHandle === sourceHandle)
  );
};

const removeInteractionsEdge = (nodeId: string) => {
  if (isFlowReadOnly.value) return;
  const sourceHandle = 'interactions-quantity-source';
  const normalizedHandle = 'interactions-quantity';
  edges.value = edges.value.filter(
    (e) =>
      !(
        e.source === nodeId &&
        (e.sourceHandle === sourceHandle || e.sourceHandle === normalizedHandle)
      )
  );
};

const addMenuNode = (position?: { x: number; y: number }) => {
  const nodeId = `menu-${nodeIdCounter++}`;
  const newNode: Node = {
    id: nodeId,
    type: 'menu',
    position: position || {
      x: getSecureRandom(400) + 100,
      y: getSecureRandom(300) + 100,
    },
    data: {
      title: '',
      message: '',
      options: [],
      onRemove: () => removeNode(nodeId),
      onRemoveOption: (optionId: string) => removeOptionEdge(nodeId, optionId),
    },
  };
  nodes.value.push(newNode);
};

const addContactMenuNode = (position?: { x: number; y: number }) => {
  const nodeId = `contact-${nodeIdCounter++}`;
  const contactOptionId = crypto.randomUUID();
  const notContactOptionId = crypto.randomUUID();
  const newNode: Node = {
    id: nodeId,
    type: 'contact',
    position: position || {
      x: getSecureRandom(400) + 100,
      y: getSecureRandom(300) + 100,
    },
    data: {
      options: [
        {
          id: contactOptionId,
          text: t('chatbot_contact_option'),
          required: true,
        },
        {
          id: notContactOptionId,
          text: t('chatbot_not_contact_option'),
          required: true,
        },
      ],
      onRemove: () => removeNode(nodeId),
      onRemoveOption: (optionId: string) => removeOptionEdge(nodeId, optionId),
    },
  };
  nodes.value.push(newNode);
};

const addSatisfactionNode = (position?: { x: number; y: number }) => {
  const nodeId = `satisfaction-${nodeIdCounter++}`;
  const newNode: Node = {
    id: nodeId,
    type: 'satisfaction',
    position: position || {
      x: getSecureRandom(400) + 100,
      y: getSecureRandom(300) + 100,
    },
    data: {
      title: '',
      message: '',
      options: [],
      onRemove: () => removeNode(nodeId),
      onRemoveOption: (optionId: string) => removeOptionEdge(nodeId, optionId),
    },
  };
  nodes.value.push(newNode);
};

const addRedirectNode = (position?: { x: number; y: number }) => {
  const nodeId = `redirect-${nodeIdCounter++}`;
  const newNode: Node = {
    id: nodeId,
    type: 'redirect',
    position: position || {
      x: getSecureRandom(400) + 100,
      y: getSecureRandom(300) + 100,
    },
    data: {
      redirectType: null,
      selectedChannel: null,
      selectedUser: null,
      selectedSector: null,
      selectedSectorUser: null,
      onRemove: () => removeNode(nodeId),
    },
  };
  nodes.value.push(newNode);
};

const addFinishNode = (position?: { x: number; y: number }) => {
  const nodeId = `finish-${nodeIdCounter++}`;
  const newNode: Node = {
    id: nodeId,
    type: 'finish',
    position: position || {
      x: getSecureRandom(400) + 100,
      y: getSecureRandom(300) + 100,
    },
    data: {
      onRemove: () => removeNode(nodeId),
    },
  };
  nodes.value.push(newNode);
};

const addTagNode = (position?: { x: number; y: number }) => {
  const nodeId = `tag-${nodeIdCounter++}`;
  const newNode: Node = {
    id: nodeId,
    type: 'tag',
    position: position || {
      x: getSecureRandom(400) + 100,
      y: getSecureRandom(300) + 100,
    },
    data: {
      tagType: null,
      selectedTag: [],
      onRemove: () => removeNode(nodeId),
    },
  };
  nodes.value.push(newNode);
};

const addAnnotationNode = (position?: { x: number; y: number }) => {
  const nodeId = `annotation-${nodeIdCounter++}`;
  const newNode: Node = {
    id: nodeId,
    type: 'annotation',
    position: position || {
      x: getSecureRandom(400) + 100,
      y: getSecureRandom(300) + 100,
    },
    data: {
      annotation: '',
      onRemove: () => removeNode(nodeId),
    },
  };
  nodes.value.push(newNode);
};

const addMessageNode = (position?: { x: number; y: number }) => {
  const nodeId = `message-${nodeIdCounter++}`;
  const newNode: Node = {
    id: nodeId,
    type: 'message',
    position: position || {
      x: getSecureRandom(400) + 100,
      y: getSecureRandom(300) + 100,
    },
    data: {
      outputKey: allocateNodeOutputKey('message'),
      messageType: null,
      text: '',
      attachmentFile: null,
      attachmentSource: 'upload',
      attachmentVariable: '',
      attachmentFileName: '',
      attachmentUrl: null,
      attachmentMimetype: null,
      attachmentDuration: null,
      attachmentWidth: null,
      attachmentHeight: null,
      continueType: null,
      onRemove: () => removeNode(nodeId),
    },
  };
  nodes.value.push(newNode);
};

const addApiRequestNode = (position?: { x: number; y: number }) => {
  const nodeId = `apiRequest-${nodeIdCounter++}`;
  const outputKey = allocateApiOutputKey();
  const newNode: Node = {
    id: nodeId,
    type: 'apiRequest',
    position: position || {
      x: getSecureRandom(400) + 100,
      y: getSecureRandom(300) + 100,
    },
    data: {
      apiRequest: createDefaultApiRequestConfig(outputKey),
      onRemove: () => removeNode(nodeId),
    },
  };
  nodes.value.push(newNode);
  applyApiRequestRuntimeData(newNode);
};

const addRandomMessageNode = (position?: { x: number; y: number }) => {
  const nodeId = `randomMessage-${nodeIdCounter++}`;
  const newNode: Node = {
    id: nodeId,
    type: 'randomMessage',
    position: position || {
      x: getSecureRandom(400) + 100,
      y: getSecureRandom(300) + 100,
    },
    data: {
      selectedRandomMessage: null,
      continueType: null,
      onRemove: () => removeNode(nodeId),
    },
  };
  nodes.value.push(newNode);
};

const addDataNode = (position?: { x: number; y: number }) => {
  const nodeId = `data-${nodeIdCounter++}`;
  const newNode: Node = {
    id: nodeId,
    type: 'data',
    position: position || {
      x: getSecureRandom(400) + 100,
      y: getSecureRandom(300) + 100,
    },
    data: {
      outputKey: allocateNodeOutputKey('data'),
      dataType: null,
      firstName: t('chatbot_data_default_name_question'),
      lastName: t('chatbot_data_default_lastname_question'),
      email: t('chatbot_data_default_email_question'),
      cpf: t('chatbot_data_default_cpf_question'),
      cnpj: t('chatbot_data_default_cnpj_question'),
      onRemove: () => removeNode(nodeId),
    },
  };
  nodes.value.push(newNode);
};

const addUnderchatNode = (position?: { x: number; y: number }) => {
  if (isFlowReadOnly.value || !hasFullAccess.value) return;
  const nodeId = `underchat-${nodeIdCounter++}`;
  const newNode: Node = {
    id: nodeId,
    type: 'underchat',
    position: position || {
      x: getSecureRandom(400) + 100,
      y: getSecureRandom(300) + 100,
    },
    data: {
      outputKey: allocateNodeOutputKey('underchat'),
      underchatLookup: {
        version: 1,
        lookupType: 'email',
        lookupExpression: '',
      },
      onRemove: () => removeNode(nodeId),
    },
  };
  nodes.value.push(newNode);
  applyUnderchatRuntimeData(newNode);
};

const addDistributionNode = (position?: { x: number; y: number }) => {
  const nodeId = `distribution-${nodeIdCounter++}`;
  const newNode: Node = {
    id: nodeId,
    type: 'distribution',
    position: position || {
      x: getSecureRandom(400) + 100,
      y: getSecureRandom(300) + 100,
    },
    data: {
      distributionType: null,
      distributionHasSector: false,
      distributionSelectedSector: null,
      onRemove: () => removeNode(nodeId),
    },
  };
  nodes.value.push(newNode);
};

const addConditionalNode = (position?: { x: number; y: number }) => {
  const nodeId = `conditional-${nodeIdCounter++}`;
  const newNode: Node = {
    id: nodeId,
    type: 'conditional',
    position: position || {
      x: getSecureRandom(400) + 100,
      y: getSecureRandom(300) + 100,
    },
    data: {
      conditionalOperand: 'message',
      conditionalVariable: '',
      conditions: [],
      onRemove: () => removeNode(nodeId),
      onRemoveCondition: (conditionId: string) =>
        removeConditionEdge(nodeId, conditionId),
    },
  };
  nodes.value.push(newNode);
};

const addWeekdayNode = (position?: { x: number; y: number }) => {
  const nodeId = `weekday-${nodeIdCounter++}`;
  const newNode: Node = {
    id: nodeId,
    type: 'weekday',
    position: position || {
      x: getSecureRandom(400) + 100,
      y: getSecureRandom(300) + 100,
    },
    data: {
      timezone: WEEKDAY_NODE_DEFAULT_TIMEZONE,
      options: buildWeekdayOptions(),
      onRemove: () => removeNode(nodeId),
    },
  };
  nodes.value.push(newNode);
};

const addHoursNode = (position?: { x: number; y: number }) => {
  const nodeId = `hours-${nodeIdCounter++}`;
  const newNode: Node = {
    id: nodeId,
    type: 'hours',
    position: position || {
      x: getSecureRandom(400) + 100,
      y: getSecureRandom(300) + 100,
    },
    data: {
      timezone: HOURS_NODE_DEFAULT_TIMEZONE,
      options: buildHoursOptions(),
      onRemove: () => removeNode(nodeId),
      onRemoveOption: (optionId: string) => removeOptionEdge(nodeId, optionId),
    },
  };
  nodes.value.push(newNode);
};

const addHolidayNode = (position?: { x: number; y: number }) => {
  const nodeId = `holiday-${nodeIdCounter++}`;
  const newNode: Node = {
    id: nodeId,
    type: 'holiday',
    position: position || {
      x: getSecureRandom(400) + 100,
      y: getSecureRandom(300) + 100,
    },
    data: {
      holidayMessage: '',
      options: [
        {
          id: HOLIDAY_IS_OPTION_ID,
          text: t('chatbot_holiday_option_is_holiday'),
          required: true,
        },
        {
          id: HOLIDAY_NOT_OPTION_ID,
          text: t('chatbot_holiday_option_not_holiday'),
          required: true,
        },
      ],
      onRemove: () => removeNode(nodeId),
      onRemoveOption: (optionId: string) => removeOptionEdge(nodeId, optionId),
    },
  };
  nodes.value.push(newNode);
};

const getOfficialDefaultData = (nodeType: OfficialNodeType) => {
  const baseData: Record<string, any> = {
    title:
      officialNodeItems.find((item) => item.type === nodeType)?.label ||
      'Oficial',
    message: '',
    text: '',
    header: '',
    footer: '',
    officialType: nodeType,
    official: {
      type: nodeType,
    },
    onRemove: undefined,
  };

  if (isOfficialWaitForResponseNodeType(nodeType)) {
    baseData.continueType = 'after_response';
  }

  if (nodeType === 'officialReplyButtons') {
    return {
      ...baseData,
      message: 'Escolha uma opção',
      text: 'Escolha uma opção',
      options: [
        { id: '1', text: 'Opção 1' },
        { id: '2', text: 'Opção 2' },
      ],
    };
  }

  if (nodeType === 'officialList') {
    return {
      ...baseData,
      message: 'Escolha uma opção',
      text: 'Escolha uma opção',
      buttonText: 'Selecionar',
      sectionTitle: 'Opções',
      options: [
        { id: '1', text: 'Opção 1', description: '' },
        { id: '2', text: 'Opção 2', description: '' },
      ],
    };
  }

  if (nodeType === 'officialCtaUrl') {
    return {
      ...baseData,
      message: 'Abrir link',
      text: 'Abrir link',
      buttonText: 'Abrir link',
      url: '',
      continueType: 'automatic',
    };
  }

  if (nodeType === 'officialLocationRequest') {
    return {
      ...baseData,
      message: 'Envie sua localização',
      text: 'Envie sua localização',
      continueType: 'after_response',
    };
  }

  if (nodeType === 'officialFlow') {
    return {
      ...baseData,
      message: 'Preencha as informações',
      text: 'Preencha as informações',
      buttonText: 'Abrir',
      flowId: '',
      flowName: '',
      flowAction: 'navigate',
      continueType: 'after_response',
    };
  }

  if (nodeType === 'officialSingleProduct') {
    return {
      ...baseData,
      catalogId: '',
      productRetailerId: '',
      continueType: 'automatic',
    };
  }

  if (nodeType === 'officialMultiProduct') {
    return {
      ...baseData,
      header: 'Produtos',
      message: 'Veja os produtos',
      text: 'Veja os produtos',
      catalogId: '',
      products: [{ product_retailer_id: '' }],
      sections: [
        {
          title: 'Produtos',
          product_items: [{ product_retailer_id: '' }],
        },
      ],
      continueType: 'automatic',
    };
  }

  if (nodeType === 'officialMediaCarousel') {
    return {
      ...baseData,
      message: 'Confira as opções',
      text: 'Confira as opções',
      cards: [
        {
          body: '',
          mediaType: 'image',
          mediaUrl: '',
          mediaId: '',
          buttonText: 'Abrir',
          buttonUrl: '',
        },
      ],
      continueType: 'automatic',
    };
  }

  if (nodeType === 'officialAddress') {
    return {
      ...baseData,
      message: 'Informe seu endereço',
      text: 'Informe seu endereço',
      addressCountry: 'BR',
      action: {
        name: 'address_message',
        parameters: {
          country: 'BR',
        },
      },
      continueType: 'after_response',
    };
  }

  if (nodeType === 'officialTemplate') {
    return {
      ...baseData,
      templateName: '',
      templateLanguage: 'pt_BR',
      templateVariables: [],
      templateCategory: null,
      templateComponents: [],
      templatePreview: null,
    };
  }

  if (nodeType === 'officialLocation') {
    return {
      ...baseData,
      latitude: null,
      longitude: null,
      name: '',
      address: '',
      continueType: 'automatic',
    };
  }

  if (nodeType === 'officialContacts') {
    return {
      ...baseData,
      contacts: [
        {
          contact_id: null,
          name: '',
          last_name: '',
          phone: '',
          phone_ddi: '55',
          email: '',
        },
      ],
      continueType: 'automatic',
    };
  }

  if (nodeType === 'officialSticker') {
    return {
      ...baseData,
      attachmentUrl: '',
      attachmentMimetype: 'image/webp',
      continueType: 'automatic',
    };
  }

  if (nodeType === 'officialReaction') {
    return {
      ...baseData,
      emoji: '👍',
      continueType: 'automatic',
    };
  }

  return {
    ...baseData,
    message: 'Abrir catálogo',
    text: 'Abrir catálogo',
    continueType: 'automatic',
  };
};

const addOfficialNode = (
  nodeType: OfficialNodeType,
  position?: { x: number; y: number }
) => {
  if (!canUseOfficialNodes.value) {
    chatbotStore.showSnackbar(
      'Nodes oficiais estão disponíveis apenas para chatbots com canal oficial WhatsApp online e sem vínculo não oficial.',
      EColor.error
    );
    return;
  }

  const nodeId = `${nodeType}-${nodeIdCounter++}`;
  const data = getOfficialDefaultData(nodeType);
  if (nodeType === 'officialTemplate') {
    applyOfficialTemplateContextToData(data);
  }
  const newNode: Node = {
    id: nodeId,
    type: nodeType,
    position: position || {
      x: getSecureRandom(400) + 100,
      y: getSecureRandom(300) + 100,
    },
    data: {
      ...data,
      onRemove: () => removeNode(nodeId),
      onRemoveOption: (optionId: string) => removeOptionEdge(nodeId, optionId),
    },
  };

  nodes.value.push(newNode);
};

const addAiAgentNode = (position?: { x: number; y: number }) => {
  const nodeId = `aiAgent-${nodeIdCounter++}`;
  const newNode: Node = {
    id: nodeId,
    type: 'aiAgent',
    position: position || {
      x: getSecureRandom(400) + 100,
      y: getSecureRandom(300) + 100,
    },
    data: {
      selectedAiAgent: null,
      actionAfterInteractions: true,
      interactionsQuantity: 5,
      options: [
        {
          id: 'negative-option',
          text: t('chatbot_ai_agent_resolved_option'),
          required: true,
        },
      ],
      onRemove: () => removeNode(nodeId),
      onRemoveOption: (optionId: string) => removeOptionEdge(nodeId, optionId),
      onRemoveInteractionsEdge: () => removeInteractionsEdge(nodeId),
    },
  };
  nodes.value.push(newNode);
};

type FlowNodePosition = { x: number; y: number };

const createNodeFromPalette = (
  nodeType: string,
  position?: FlowNodePosition
): void => {
  if (isFlowReadOnly.value) return;
  if (nodeType === 'underchat' && !hasFullAccess.value) return;

  if (isOfficialChatbotNodeType(nodeType)) {
    addOfficialNode(nodeType as OfficialNodeType, position);
    return;
  }

  const nodeCreators: Record<
    string,
    (targetPosition?: FlowNodePosition) => void
  > = {
    menu: addMenuNode,
    satisfaction: addSatisfactionNode,
    redirect: addRedirectNode,
    finish: addFinishNode,
    tag: addTagNode,
    message: addMessageNode,
    randomMessage: addRandomMessageNode,
    data: addDataNode,
    underchat: addUnderchatNode,
    contact: addContactMenuNode,
    aiAgent: addAiAgentNode,
    annotation: addAnnotationNode,
    distribution: addDistributionNode,
    conditional: addConditionalNode,
    weekday: addWeekdayNode,
    hours: addHoursNode,
    holiday: addHolidayNode,
    apiRequest: addApiRequestNode,
  };

  nodeCreators[nodeType]?.(position);
};

const isValidConnection = (connection: Connection): boolean => {
  if (isFlowReadOnly.value) return false;

  const sourceHandleId = connection.sourceHandle
    ? String(connection.sourceHandle)
    : null;
  const targetHandleId = connection.targetHandle
    ? String(connection.targetHandle)
    : null;

  const sourceNode = nodes.value.find((node) => node.id === connection.source);
  if (
    sourceNode?.type === 'underchat' &&
    (sourceHandleId === 'found' || sourceHandleId === 'not_found')
  ) {
    const alreadyConnected = edges.value.some(
      (edge) =>
        edge.source === connection.source &&
        edge.sourceHandle === sourceHandleId &&
        (edge.target !== connection.target ||
          (edge.targetHandle || null) !== targetHandleId)
    );
    if (alreadyConnected) {
      chatbotStore.showSnackbar(
        t('chatbot_flow_validation_underchat_handle_already_connected'),
        EColor.error
      );
      return false;
    }
  }

  if (!sourceHandleId && !targetHandleId) {
    const nodeTypesOnlyTarget = ['redirect', 'distribution', 'finish'];
    const nodeTypesOnlySource = ['start'];
    const plainSourceNode = nodes.value.find(
      (node) => node.id === connection.source
    );
    const targetNode = nodes.value.find((n) => n.id === connection.target);
    const sourceType = plainSourceNode?.type as string | undefined;
    const targetType = targetNode?.type as string | undefined;

    if (sourceType && nodeTypesOnlyTarget.includes(sourceType)) {
      chatbotStore.showSnackbar(
        t('chatbot_flow_validation_invalid_source_handle'),
        EColor.error
      );
      return false;
    }

    if (targetType && nodeTypesOnlySource.includes(targetType)) {
      chatbotStore.showSnackbar(
        t('chatbot_flow_validation_invalid_target_handle'),
        EColor.error
      );
      return false;
    }

    return true;
  }

  const isSourceHandleById = (handleId: string): boolean => {
    const lowerId = handleId.toLowerCase();
    return (
      lowerId.includes('-source') ||
      lowerId.endsWith('source') ||
      lowerId === 'interactions-quantity' ||
      lowerId === 'fallback' ||
      lowerId === 'default' ||
      lowerId === 'success' ||
      lowerId === 'failure' ||
      lowerId === 'found' ||
      lowerId === 'not_found'
    );
  };

  const isTargetHandleById = (handleId: string): boolean => {
    const lowerId = handleId.toLowerCase();
    return lowerId.includes('-target') || lowerId.endsWith('target');
  };

  if (sourceHandleId && targetHandleId) {
    const sourceIsSource = isSourceHandleById(sourceHandleId);
    const targetIsTarget = isTargetHandleById(targetHandleId);
    const sourceIsTarget = isTargetHandleById(sourceHandleId);
    const targetIsSource = isSourceHandleById(targetHandleId);

    if (sourceIsSource && targetIsSource) {
      chatbotStore.showSnackbar(
        t('chatbot_flow_validation_same_handle_type'),
        EColor.error
      );
      return false;
    }

    if (sourceIsTarget && targetIsTarget) {
      chatbotStore.showSnackbar(
        t('chatbot_flow_validation_same_handle_type'),
        EColor.error
      );
      return false;
    }

    if (sourceIsTarget && !targetIsTarget && !targetIsSource) {
      chatbotStore.showSnackbar(
        t('chatbot_flow_validation_invalid_source_handle'),
        EColor.error
      );
      return false;
    }

    if (targetIsSource && !sourceIsSource && !sourceIsTarget) {
      chatbotStore.showSnackbar(
        t('chatbot_flow_validation_invalid_target_handle'),
        EColor.error
      );
      return false;
    }
  }

  if (
    sourceHandleId &&
    isTargetHandleById(sourceHandleId) &&
    !isSourceHandleById(sourceHandleId)
  ) {
    chatbotStore.showSnackbar(
      t('chatbot_flow_validation_invalid_source_handle'),
      EColor.error
    );
    return false;
  }

  if (
    targetHandleId &&
    isSourceHandleById(targetHandleId) &&
    !isTargetHandleById(targetHandleId)
  ) {
    chatbotStore.showSnackbar(
      t('chatbot_flow_validation_invalid_target_handle'),
      EColor.error
    );
    return false;
  }

  return true;
};

const onConnect = (connection: Connection) => {
  if (isFlowReadOnly.value) return;

  if (!isValidConnection(connection)) {
    return;
  }

  const normalizedSourceHandle = normalizeConnectionSourceHandle(connection);
  const normalizedTargetHandle = connection.targetHandle
    ? String(connection.targetHandle)
    : undefined;

  const source = connection.source;
  const target = connection.target;

  const existingEdge = edges.value.find((e) => {
    return (
      e.source === source &&
      e.target === target &&
      e.sourceHandle === normalizedSourceHandle &&
      e.targetHandle === normalizedTargetHandle
    );
  });
  if (existingEdge) return;

  const edgeIdParts = [
    'e',
    connection.source,
    connection.target,
    normalizedSourceHandle || '',
    normalizedTargetHandle || '',
    Date.now().toString(),
  ];
  const edgeId = edgeIdParts.join('-');

  const newEdge = normalizeEdge({
    id: edgeId,
    source: connection.source!,
    target: connection.target!,
    sourceHandle: normalizedSourceHandle,
    targetHandle: normalizedTargetHandle,
    markerEnd: {
      type: 'arrowclosed',
      color: '#1a192b',
    } as any,
    style: {
      stroke: '#1a192b',
      strokeWidth: 2,
    },
    class: '',
  });

  edges.value.push(newEdge);
};

const calculateDistance = (node1: Node, node2: Node): number => {
  return Math.sqrt(
    Math.pow(node1.position.x - node2.position.x, 2) +
      Math.pow(node1.position.y - node2.position.y, 2)
  );
};

const hasExistingEdge = (sourceId: string, targetId: string): boolean => {
  return edges.value.some(
    (e) => e.source === sourceId && e.target === targetId
  );
};

const tryAutoConnectNode = (draggedNode: Node): void => {
  const otherNodes = nodes.value.filter((n) => n.id !== draggedNode.id);
  const connectionThreshold = 80;

  for (const otherNode of otherNodes) {
    const distance = calculateDistance(draggedNode, otherNode);

    if (distance < connectionThreshold) {
      if (!hasExistingEdge(draggedNode.id, otherNode.id)) {
        onConnect({
          source: draggedNode.id,
          target: otherNode.id,
        });
      }
      break;
    }
  }
};

const isPositionChange = (
  change: NodeChange
): change is NodeChange & { type: 'position'; id: string } => {
  return (
    change.type === 'position' &&
    change.dragging === false &&
    change.position !== undefined &&
    'id' in change
  );
};

const onNodesChange = (changes: NodeChange[]) => {
  if (isFlowReadOnly.value) return;
  for (const change of changes) {
    if (!isPositionChange(change)) continue;

    const draggedNode = nodes.value.find((n) => n.id === change.id);
    if (!draggedNode) continue;

    tryAutoConnectNode(draggedNode);
  }
};

const isLoadingFlow = ref(false);
const draggedNodeType = ref<string | null>(null);
const vueFlowRef = ref<InstanceType<typeof VueFlow> | null>(null);

const zoomInFlow = (): void => {
  void vueFlowRef.value?.zoomIn();
};

const zoomOutFlow = (): void => {
  void vueFlowRef.value?.zoomOut();
};

const fitFlowView = (): void => {
  void vueFlowRef.value?.fitView({ padding: 0.24, duration: 220 });
};

const getFlowCanvasElement = (): HTMLElement | null =>
  flowAreaRef.value?.querySelector<HTMLElement>('.vue-flow') || null;

const getFlowPositionFromClient = (
  clientX: number,
  clientY: number
): FlowNodePosition | null => {
  const vueFlowElement = getFlowCanvasElement();
  if (!vueFlowElement) return null;

  const rect = vueFlowElement.getBoundingClientRect();
  const viewport = vueFlowRef.value?.viewport || { x: 0, y: 0, zoom: 1 };

  return {
    x: (clientX - rect.left - viewport.x) / viewport.zoom,
    y: (clientY - rect.top - viewport.y) / viewport.zoom,
  };
};

const onPaletteCreate = (nodeType: string): void => {
  if (isFlowReadOnly.value) return;
  const vueFlowElement = getFlowCanvasElement();
  if (!vueFlowElement) return;

  const rect = vueFlowElement.getBoundingClientRect();
  const position = getFlowPositionFromClient(
    rect.left + rect.width / 2,
    rect.top + rect.height / 2
  );

  if (position) {
    createNodeFromPalette(nodeType, position);
  }
};

const onPaletteDragStart = (nodeType: string, event: DragEvent): void => {
  if (isFlowReadOnly.value) return;
  draggedNodeType.value = nodeType;

  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.dropEffect = 'move';
    event.dataTransfer.setData('application/x-underchat-node', nodeType);
  }
};

const onPaletteDragEnd = (): void => {
  draggedNodeType.value = null;
};

const onDrop = (event: DragEvent) => {
  if (isFlowReadOnly.value) return;
  const nodeType = draggedNodeType.value;
  if (!nodeType) return;

  event.preventDefault();
  event.stopPropagation();

  try {
    const position = getFlowPositionFromClient(event.clientX, event.clientY);
    if (position) {
      createNodeFromPalette(nodeType, position);
    }
  } finally {
    draggedNodeType.value = null;
  }
};

const prepareNodesForSave = (
  nodesToSave: Node[]
): Array<{
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, any>;
  label?: string;
  draggable?: boolean;
}> => {
  return nodesToSave.map((node) => {
    const nodeData = toSerializableNodeData(
      node.data as Record<string, unknown> | undefined
    );
    if (node.type === 'officialCtaUrl') {
      nodeData.continueType = 'automatic';
    } else if (isOfficialWaitForResponseNodeType(node.type)) {
      nodeData.continueType = 'after_response';
    }
    if (nodeData && 'attachmentFile' in nodeData) {
      delete nodeData.attachmentFile;
    }
    if (nodeData && 'onRemove' in nodeData) {
      delete nodeData.onRemove;
    }
    if (nodeData && 'onRemoveOption' in nodeData) {
      delete nodeData.onRemoveOption;
    }
    delete nodeData.availableOfficialTemplates;
    delete nodeData.isLoadingOfficialTemplates;
    delete nodeData.officialTemplatesError;
    if (
      node.type === 'data' &&
      (nodeData.dataType === null || nodeData.dataType === undefined)
    ) {
      delete nodeData.dataType;
    }
    if (node.type === 'aiAgent') {
      if (nodeData.selectedAiAgent === undefined) {
        nodeData.selectedAiAgent = null;
      }
      delete nodeData.defaultQuestion;
      delete nodeData.continueMessage;
      if (
        nodeData.actionAfterInteractions === undefined ||
        nodeData.actionAfterInteractions === null
      ) {
        nodeData.actionAfterInteractions = true;
      }
      if (
        nodeData.interactionsQuantity === undefined ||
        nodeData.interactionsQuantity === null
      ) {
        nodeData.interactionsQuantity = 5;
      }
      if (nodeData.options && Array.isArray(nodeData.options)) {
        nodeData.options = normalizeOptions(nodeData.options);
      }
    }
    return {
      id: node.id,
      type: node.type || '',
      position: {
        x: node.position.x,
        y: node.position.y,
      },
      data: nodeData,
      label: typeof node.label === 'string' ? node.label : undefined,
      draggable: node.draggable,
    };
  });
};

const validateAllNodesConnected = (): string | null => {
  const nodesWithoutOutput: Node[] = [];

  for (const node of nodes.value) {
    if (
      node.type === 'finish' ||
      node.type === 'annotation' ||
      node.type === 'redirect' ||
      node.type === 'distribution'
    ) {
      continue;
    }

    const hasOutput = edges.value.some((edge) => edge.source === node.id);

    if (!hasOutput) {
      nodesWithoutOutput.push(node);
    }
  }

  if (nodesWithoutOutput.length > 0) {
    const nodeLabels: string[] = [];
    for (const node of nodesWithoutOutput) {
      const label = node.data?.title || node.label || node.id;
      nodeLabels.push(label);
    }
    return t('chatbot_flow_validation_node_not_connected', {
      nodeLabel: nodeLabels.join(', '),
    });
  }

  return null;
};

const validateApiRequestNodesBeforeSave = (): string | null => {
  for (const node of nodes.value) {
    if (node.type !== 'apiRequest') continue;
    const config = node.data?.apiRequest as ApiRequestConfig | undefined;
    const nodeLabel = config?.outputKey || node.label || node.id;
    if (!config) {
      return `Configure o node de API "${nodeLabel}".`;
    }
    if (config.test.state !== 'tested' || !config.test.evidence) {
      return `Teste novamente a chamada "${nodeLabel}" antes de salvar.`;
    }

    const outgoing = edges.value.filter((edge) => edge.source === node.id);
    if (!outgoing.some((edge) => edge.sourceHandle === 'success')) {
      return `Conecte a saída Sucesso da chamada "${nodeLabel}".`;
    }
    if (!outgoing.some((edge) => edge.sourceHandle === 'failure')) {
      return `Conecte a saída Falha da chamada "${nodeLabel}".`;
    }
  }

  try {
    const [dependencyError] = validateChatbotApiVariableDependencies(
      getGraphFlow() as any
    );
    if (!dependencyError) return null;
    const node = nodes.value.find(
      (candidate) => candidate.id === dependencyError.nodeId
    );
    const nodeLabel =
      node?.data?.title || node?.label || dependencyError.nodeId;
    if (dependencyError.code === 'missing_api_origin') {
      return `A variável {{ ${dependencyError.path} }} usada em "${nodeLabel}" não possui uma API de origem.`;
    }
    if (dependencyError.code === 'missing_output_origin') {
      return t('chatbot_flow_validation_output_origin_missing', {
        path: `{{ ${dependencyError.path} }}`,
        nodeLabel,
      });
    }
    if (dependencyError.code === 'uncaptured_api_path') {
      return `O caminho {{ ${dependencyError.path} }} usado em "${nodeLabel}" não está capturado na API de origem.`;
    }
    if (dependencyError.code === 'uncaptured_output_path') {
      return t('chatbot_flow_validation_output_path_unavailable', {
        path: `{{ ${dependencyError.path} }}`,
        nodeLabel,
      });
    }
    if (dependencyError.code === 'ambiguous_output_dependency') {
      return t('chatbot_flow_validation_output_dependency_ambiguous', {
        path: `{{ ${dependencyError.path} }}`,
        nodeLabel,
      });
    }
    if (dependencyError.code === 'missing_api_branch') {
      const branch = dependencyError.path === 'success' ? 'Sucesso' : 'Falha';
      return `Conecte a saída ${branch} do node "${nodeLabel}".`;
    }
    return `A variável {{ ${dependencyError.path} }} não é garantida em todos os caminhos até "${nodeLabel}".`;
  } catch {
    return 'Há uma variável de API inválida ou insegura no fluxo.';
  }
};

const validateUnderchatNodesBeforeSave = (): string | null => {
  for (const node of nodes.value) {
    if (node.type !== 'underchat') continue;
    const nodeLabel = node.data?.outputKey || node.label || node.id;
    if (!getChatbotNodeOutputDefinition(node as any)) {
      return t('chatbot_flow_validation_underchat_configuration_required', {
        nodeLabel,
      });
    }

    const outgoing = edges.value.filter((edge) => edge.source === node.id);
    const foundCount = outgoing.filter(
      (edge) => edge.sourceHandle === 'found'
    ).length;
    const notFoundCount = outgoing.filter(
      (edge) => edge.sourceHandle === 'not_found'
    ).length;
    if (outgoing.length !== 2 || foundCount !== 1 || notFoundCount !== 1) {
      return t('chatbot_flow_validation_underchat_branches_required', {
        nodeLabel,
      });
    }
  }
  return null;
};

const validateVariableAttachmentsBeforeSave = (): string | null => {
  for (const node of nodes.value) {
    if (node.type !== 'message') continue;
    const data = node.data as Record<string, unknown> | undefined;
    const messageType = data?.messageType;
    const usesMedia = ['image', 'audio', 'video', 'document'].includes(
      String(messageType || '')
    );
    if (!usesMedia || data?.attachmentSource !== 'variable') continue;
    if (
      typeof data.attachmentVariable !== 'string' ||
      !data.attachmentVariable.trim()
    ) {
      const nodeLabel = node.data?.title || node.label || node.id;
      return `Selecione a variável do anexo no node "${nodeLabel}".`;
    }
  }
  return null;
};

const toHoursMinutes = (value?: string): number | null => {
  if (!isValidHoursTime(value)) {
    return null;
  }

  const [hours, minutes] = (value || '')
    .split(':')
    .map((item) => Number.parseInt(item, 10));

  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return null;
  }

  return hours * 60 + minutes;
};

interface MinuteRange {
  start: number;
  end: number;
}

const buildDailyRanges = (
  startMinutes: number,
  endMinutes: number
): MinuteRange[] => {
  if (startMinutes < endMinutes) {
    return [
      {
        start: startMinutes,
        end: endMinutes,
      },
    ];
  }

  return [
    {
      start: startMinutes,
      end: 1439,
    },
    {
      start: 0,
      end: endMinutes,
    },
  ];
};

const hasRangeConflict = (first: MinuteRange, second: MinuteRange): boolean => {
  return first.start <= second.end && second.start <= first.end;
};

const validateHoursNodesBeforeSave = (): string | null => {
  for (const node of nodes.value) {
    if (node.type !== 'hours') {
      continue;
    }

    const nodeTitle =
      typeof node.data?.title === 'string' ? node.data.title.trim() : '';
    const nodeLabel = nodeTitle || t('chatbot_hours');
    const options = Array.isArray(node.data?.options)
      ? (node.data.options as HoursOption[])
      : [];

    if (options.length === 0) {
      return t('chatbot_flow_validation_options_required', { nodeLabel });
    }

    const outsideOption = options.find(
      (option) => option.id === HOURS_OUTSIDE_OPTION_ID
    );
    if (!outsideOption) {
      return t('chatbot_flow_validation_hours_outside_option_required', {
        nodeLabel,
      });
    }

    const intervalOptions = options.filter(
      (option) => option.id !== HOURS_OUTSIDE_OPTION_ID
    );
    if (intervalOptions.length === 0) {
      return t('chatbot_flow_validation_hours_interval_required', {
        nodeLabel,
      });
    }

    for (const option of options) {
      const expectedSourceHandle = `option-${option.id}-source`;
      const hasConnection = edges.value.some(
        (edge) =>
          edge.source === node.id && edge.sourceHandle === expectedSourceHandle
      );

      if (!hasConnection) {
        return t('chatbot_flow_validation_option_not_connected', {
          nodeLabel,
          optionText: option.text || `Opção ${option.id}`,
        });
      }
    }

    const normalizedIntervals = intervalOptions.map((option) => {
      const start = toHoursMinutes(option.start_time);
      const end = toHoursMinutes(option.end_time);

      return {
        option,
        start,
        end,
        ranges:
          start !== null && end !== null && start !== end
            ? buildDailyRanges(start, end)
            : [],
      };
    });

    for (const interval of normalizedIntervals) {
      if (
        interval.start === null ||
        interval.end === null ||
        interval.start === interval.end
      ) {
        return t('chatbot_flow_validation_hours_invalid_time_range', {
          nodeLabel,
          interval:
            interval.option.text ||
            `${interval.option.start_time || '--:--'} -> ${
              interval.option.end_time || '--:--'
            }`,
        });
      }
    }

    for (let i = 0; i < normalizedIntervals.length; i++) {
      const current = normalizedIntervals[i];
      for (let j = i + 1; j < normalizedIntervals.length; j++) {
        const next = normalizedIntervals[j];

        const hasConflict = current.ranges.some((currentRange) => {
          return next.ranges.some((nextRange) =>
            hasRangeConflict(currentRange, nextRange)
          );
        });

        if (hasConflict) {
          return t('chatbot_flow_validation_hours_conflict', {
            nodeLabel,
          });
        }
      }
    }
  }

  return null;
};

const getOfficialProductId = (product: any): string => {
  if (typeof product === 'string') return product.trim();
  if (!product || typeof product !== 'object') return '';

  const value = product.product_retailer_id ?? product.productRetailerId;
  return typeof value === 'string' ? value.trim() : '';
};

const hasOfficialMultiProductItems = (node: Node): boolean => {
  const data = node.data as any;
  const directProducts = [
    ...(Array.isArray(data?.products) ? data.products : []),
    ...(Array.isArray(data?.official?.products) ? data.official.products : []),
  ];

  if (directProducts.some((product) => getOfficialProductId(product))) {
    return true;
  }

  const sections = [
    ...(Array.isArray(data?.sections) ? data.sections : []),
    ...(Array.isArray(data?.official?.sections) ? data.official.sections : []),
  ];

  return sections.some((section) => {
    if (!section || typeof section !== 'object') return false;
    const sectionRecord = section as any;
    const productItems = Array.isArray(sectionRecord.product_items)
      ? sectionRecord.product_items
      : Array.isArray(sectionRecord.products)
        ? sectionRecord.products
        : [];

    return productItems.some((product: any) => getOfficialProductId(product));
  });
};

const hasOfficialCarouselCards = (node: Node): boolean => {
  const data = node.data as any;
  const cards = [
    ...(Array.isArray(data?.cards) ? data.cards : []),
    ...(Array.isArray(data?.official?.cards) ? data.official.cards : []),
  ];

  return cards.some((card) => {
    if (!card || typeof card !== 'object') return false;
    if (Array.isArray(card.components) && card.components.length > 0) {
      return true;
    }

    const body =
      typeof card.body === 'string'
        ? card.body.trim()
        : typeof card.text === 'string'
          ? card.text.trim()
          : '';
    const mediaUrl =
      typeof card.mediaUrl === 'string'
        ? card.mediaUrl.trim()
        : typeof card.media_url === 'string'
          ? card.media_url.trim()
          : '';
    const mediaId =
      typeof card.mediaId === 'string'
        ? card.mediaId.trim()
        : typeof card.media_id === 'string'
          ? card.media_id.trim()
          : '';

    return body.length > 0 && (mediaUrl.length > 0 || mediaId.length > 0);
  });
};

const hasOfficialContacts = (node: Node): boolean => {
  const data = node.data as any;
  const contacts = [
    ...(Array.isArray(data?.contacts) ? data.contacts : []),
    ...(Array.isArray(data?.official?.contacts) ? data.official.contacts : []),
  ];

  return contacts.some((contact) => {
    if (!contact || typeof contact !== 'object') return false;

    const name = typeof contact.name === 'string' ? contact.name.trim() : '';
    const phone = typeof contact.phone === 'string' ? contact.phone.trim() : '';

    return name.length > 0 && phone.length > 0;
  });
};

const validateOfficialNodesBeforeSave = (): string | null => {
  if (!hasOfficialNodesInCanvas.value) {
    return null;
  }

  if (!canUseOfficialNodes.value) {
    return 'Nodes oficiais só podem ser salvos em chatbot com canal oficial WhatsApp online e sem vínculo com canal não oficial.';
  }

  for (const node of nodes.value) {
    const limitViolation = findOfficialInteractiveLimitViolation(
      node.type ?? '',
      node.data as Record<string, unknown> | undefined
    );
    if (limitViolation) {
      const nodeLabel = node.data?.title || node.label || node.id;
      if (limitViolation.kind === 'emoji') {
        return t('chatbot_flow_validation_official_meta_emoji', {
          field: t(limitViolation.fieldLabelKey),
          nodeLabel,
        });
      }
      return t('chatbot_flow_validation_official_meta_limit', {
        field: t(limitViolation.fieldLabelKey),
        nodeLabel,
        actual: limitViolation.actual,
        limit: limitViolation.limit,
      });
    }

    if (node.type === 'officialMultiProduct') {
      const nodeLabel = node.data?.title || node.label || node.id;
      const header =
        typeof node.data?.header === 'string' ? node.data.header.trim() : '';
      const body =
        typeof node.data?.message === 'string'
          ? node.data.message.trim()
          : typeof node.data?.text === 'string'
            ? node.data.text.trim()
            : '';
      const catalogId =
        typeof node.data?.catalogId === 'string'
          ? node.data.catalogId.trim()
          : '';

      if (!header || !body) {
        return t('chatbot_flow_validation_official_multi_product_content', {
          nodeLabel,
        });
      }

      if (!catalogId || !hasOfficialMultiProductItems(node)) {
        return `Informe o ID do catálogo e pelo menos um produto no node "${nodeLabel}".`;
      }
    }

    if (node.type === 'officialMediaCarousel') {
      const nodeLabel = node.data?.title || node.label || node.id;
      if (!hasOfficialCarouselCards(node)) {
        return `Informe texto e mídia em pelo menos um card no node "${nodeLabel}".`;
      }
    }

    if (node.type === 'officialContacts') {
      const nodeLabel = node.data?.title || node.label || node.id;
      if (!hasOfficialContacts(node)) {
        return `Informe nome e telefone em pelo menos um contato no node "${nodeLabel}".`;
      }
    }

    if (node.type !== 'officialReplyButtons' && node.type !== 'officialList') {
      continue;
    }

    const nodeLabel = node.data?.title || node.label || node.id;
    const options = Array.isArray(node.data?.options) ? node.data.options : [];
    const maxOptions =
      node.type === 'officialReplyButtons'
        ? OFFICIAL_INTERACTIVE_LIMITS.replyButtonCount
        : 10;

    if (options.length === 0 || options.length > maxOptions) {
      return `Revise as opções do node "${nodeLabel}".`;
    }

    for (const option of options) {
      const expectedSourceHandle = `option-${option.id}-source`;
      const hasConnection = edges.value.some(
        (edge) =>
          edge.source === node.id &&
          (edge.sourceHandle === expectedSourceHandle ||
            edge.sourceHandle === option.id)
      );

      if (!hasConnection) {
        return t('chatbot_flow_validation_option_not_connected', {
          nodeLabel,
          optionText: option.text || `Opção ${option.id}`,
        });
      }
    }
  }

  return null;
};

const handleSave = async () => {
  if (isFlowReadOnly.value) return;
  if (!chatbotId.value) {
    chatbotStore.showSnackbar(
      t('chatbot_flow_validation_chatbot_id_required'),
      EColor.error
    );
    return;
  }

  const validationError = validateAllNodesConnected();
  if (validationError) {
    chatbotStore.showSnackbar(validationError, EColor.error);
    return;
  }

  const underchatValidationError = validateUnderchatNodesBeforeSave();
  if (underchatValidationError) {
    chatbotStore.showSnackbar(underchatValidationError, EColor.error);
    return;
  }

  const apiRequestValidationError = validateApiRequestNodesBeforeSave();
  if (apiRequestValidationError) {
    chatbotStore.showSnackbar(apiRequestValidationError, EColor.error);
    return;
  }

  const variableAttachmentValidationError =
    validateVariableAttachmentsBeforeSave();
  if (variableAttachmentValidationError) {
    chatbotStore.showSnackbar(variableAttachmentValidationError, EColor.error);
    return;
  }

  const dataNodesWithoutType: Node[] = [];
  for (const node of nodes.value) {
    if (node.type !== 'data') {
      continue;
    }
    const dataType = node.data?.dataType;
    if (
      !dataType ||
      dataType === null ||
      dataType === undefined ||
      (typeof dataType === 'string' && dataType.trim() === '')
    ) {
      dataNodesWithoutType.push(node);
    }
  }

  if (dataNodesWithoutType.length > 0) {
    const nodeLabels: string[] = [];
    for (const node of dataNodesWithoutType) {
      const label = node.data?.title || node.label || node.id;
      nodeLabels.push(label);
    }
    chatbotStore.showSnackbar(
      t('chatbot_flow_validation_data_type_required', {
        nodeLabel: nodeLabels.join(', '),
      }),
      EColor.error
    );
    return;
  }

  const conditionalNodesWithoutDefault: Node[] = [];
  for (const node of nodes.value) {
    if (node.type !== 'conditional') {
      continue;
    }

    const defaultHandleId = 'default-source';
    const normalizedDefaultHandle = 'default';

    const outgoingEdges = edges.value.filter((edge) => edge.source === node.id);

    const hasDefaultConnection = outgoingEdges.some((edge) => {
      const edgeHandleId = normalizeHandleId(
        edge.sourceHandle ? String(edge.sourceHandle) : null
      );
      const rawHandleId = edge.sourceHandle ? String(edge.sourceHandle) : null;

      return (
        edgeHandleId === normalizedDefaultHandle ||
        rawHandleId === defaultHandleId ||
        rawHandleId === 'default'
      );
    });

    if (!hasDefaultConnection) {
      conditionalNodesWithoutDefault.push(node);
    }
  }

  if (conditionalNodesWithoutDefault.length > 0) {
    const nodeLabels: string[] = [];
    for (const node of conditionalNodesWithoutDefault) {
      const label = node.data?.title || node.label || node.id;
      nodeLabels.push(label);
    }
    chatbotStore.showSnackbar(
      t('chatbot_flow_validation_conditional_default_handle_required', {
        nodeLabel: nodeLabels.join(', '),
      }),
      EColor.error
    );
    return;
  }

  const hoursValidationError = validateHoursNodesBeforeSave();
  if (hoursValidationError) {
    chatbotStore.showSnackbar(hoursValidationError, EColor.error);
    return;
  }

  if (hasOfficialNodesInCanvas.value) {
    await loadOfficialCapabilities();
  }

  const officialValidationError = validateOfficialNodesBeforeSave();
  if (officialValidationError) {
    chatbotStore.showSnackbar(officialValidationError, EColor.error);
    return;
  }

  isLoadingFlow.value = true;

  try {
    await nextTick();
    const preparedNodes = prepareNodesForSave(nodes.value);

    const preparedEdges = edges.value.map((edge) => {
      const normalizedEdge = normalizeEdge(edge);
      return {
        id: normalizedEdge.id,
        source: normalizedEdge.source,
        target: normalizedEdge.target,
        sourceHandle: normalizedEdge.sourceHandle || undefined,
        targetHandle: normalizedEdge.targetHandle || undefined,
      };
    });

    const requestData = {
      chatbot_id: chatbotId.value,
      nodes: preparedNodes,
      edges: preparedEdges,
    };

    const formData = new FormData();
    formData.append('request', JSON.stringify(requestData));

    for (const node of nodes.value) {
      if (node.type !== 'message') {
        continue;
      }
      const data = node.data as any;
      const messageType = data.messageType;
      const attachmentFile = data.attachmentFile as File | null;

      if (data.attachmentSource === 'variable' || !attachmentFile) {
        continue;
      }

      if (messageType === 'image') {
        formData.append(`image_${node.id}`, attachmentFile);
        continue;
      }

      if (messageType === 'video') {
        formData.append(`video_${node.id}`, attachmentFile);
        continue;
      }

      if (messageType === 'audio') {
        formData.append(`audio_${node.id}`, attachmentFile);
        continue;
      }

      if (messageType === 'document') {
        formData.append(`document_${node.id}`, attachmentFile);
      }
    }

    await chatbotStore.saveChatbotFlow(formData);
  } catch (error) {
    console.error('Error saving flow:', error);
  } finally {
    isLoadingFlow.value = false;
  }
};

const normalizeOptionId = (option: any): any => {
  if (option && option.id) {
    const normalizedId = option.id.replace(/^option-/i, '');
    return {
      ...option,
      id: normalizedId,
    };
  }
  return option;
};

const normalizeOptions = (options: any[]): any[] => {
  if (!Array.isArray(options)) {
    return [];
  }
  return options.map(normalizeOptionId);
};

const processMenuNodeData = (nodeData: any): void => {
  if (!nodeData.options) {
    nodeData.options = [];
  }
  if (Array.isArray(nodeData.options)) {
    nodeData.options = normalizeOptions(nodeData.options);
  }
};

const processSatisfactionNodeData = (nodeData: any): void => {
  processMenuNodeData(nodeData);
};

const processRedirectNodeData = (nodeData: any): void => {
  if (nodeData.redirectType === undefined) nodeData.redirectType = null;
  if (nodeData.selectedChannel === undefined) nodeData.selectedChannel = null;
  if (nodeData.selectedUser === undefined) nodeData.selectedUser = null;
  if (nodeData.selectedSector === undefined) nodeData.selectedSector = null;
  if (nodeData.selectedSectorUser === undefined)
    nodeData.selectedSectorUser = null;
};

const processTagNodeData = (nodeData: any): void => {
  if (nodeData.tagType === undefined) nodeData.tagType = null;
  if (nodeData.selectedTag === undefined) {
    nodeData.selectedTag = [];
  }
};

const processAnnotationNodeData = (nodeData: any): void => {
  if (nodeData.annotation === undefined) nodeData.annotation = '';
};

const processAiAgentNodeData = (nodeData: any): void => {
  if (nodeData.selectedAiAgent === undefined) nodeData.selectedAiAgent = null;
  delete nodeData.defaultQuestion;
  delete nodeData.continueMessage;
  if (nodeData.actionAfterInteractions === undefined)
    nodeData.actionAfterInteractions = true;
  if (nodeData.interactionsQuantity === undefined)
    nodeData.interactionsQuantity = 5;
  nodeData.options = [
    {
      id: 'negative-option',
      text: t('chatbot_ai_agent_resolved_option'),
      required: true,
    },
  ];
};

const processMessageNodeData = (nodeData: any): void => {
  if (nodeData.messageType === undefined) nodeData.messageType = null;
  if (nodeData.text === undefined) nodeData.text = '';
  if (nodeData.attachmentFile === undefined) nodeData.attachmentFile = null;
  if (nodeData.attachmentSource === undefined) {
    nodeData.attachmentSource = nodeData.attachmentVariable
      ? 'variable'
      : 'upload';
  }
  if (nodeData.attachmentVariable === undefined)
    nodeData.attachmentVariable = '';
  if (nodeData.attachmentFileName === undefined)
    nodeData.attachmentFileName = '';
  if (nodeData.attachmentUrl === undefined) nodeData.attachmentUrl = null;
  if (nodeData.attachmentMimetype === undefined)
    nodeData.attachmentMimetype = null;
  if (nodeData.attachmentDuration === undefined)
    nodeData.attachmentDuration = null;
  if (nodeData.attachmentWidth === undefined) nodeData.attachmentWidth = null;
  if (nodeData.attachmentHeight === undefined) nodeData.attachmentHeight = null;
  if (nodeData.continueType === undefined) nodeData.continueType = null;
};

const processApiRequestNodeData = (nodeData: any): void => {
  const rawOutputKey = nodeData.apiRequest?.outputKey;
  const outputKey =
    typeof rawOutputKey === 'string' && /^api_[1-9]\d*$/.test(rawOutputKey)
      ? rawOutputKey
      : 'api_1';
  nodeData.apiRequest = normalizeApiRequestConfig(nodeData.apiRequest, {
    outputKey,
  });
};

const processRandomMessageNodeData = (nodeData: any): void => {
  if (nodeData.selectedRandomMessage === undefined)
    nodeData.selectedRandomMessage = null;
  if (nodeData.continueType === undefined) nodeData.continueType = null;
};

const processDataNodeData = (nodeData: any): void => {
  if (nodeData.firstName === undefined)
    nodeData.firstName = t('chatbot_data_default_name_question');
  if (nodeData.lastName === undefined)
    nodeData.lastName = t('chatbot_data_default_lastname_question');
  if (nodeData.email === undefined)
    nodeData.email = t('chatbot_data_default_email_question');
  if (nodeData.cpf === undefined)
    nodeData.cpf = t('chatbot_data_default_cpf_question');
  if (nodeData.cnpj === undefined)
    nodeData.cnpj = t('chatbot_data_default_cnpj_question');
};

const processUnderchatNodeData = (nodeData: any): void => {
  const lookup = nodeData.underchatLookup;
  nodeData.underchatLookup = {
    version: 1,
    lookupType: lookup?.lookupType === 'document' ? 'document' : 'email',
    lookupExpression:
      typeof lookup?.lookupExpression === 'string'
        ? lookup.lookupExpression
        : '',
  } satisfies UnderchatLookupConfig;
};

const processDistributionNodeData = (nodeData: any): void => {
  if (nodeData.distributionType === undefined) nodeData.distributionType = null;
  if (nodeData.distributionHasSector === undefined)
    nodeData.distributionHasSector = false;
  if (nodeData.distributionSelectedSector === undefined)
    nodeData.distributionSelectedSector = null;
};

const processConditionalNodeData = (nodeData: any): void => {
  if (
    nodeData.conditionalOperand !== 'message' &&
    nodeData.conditionalOperand !== 'variable'
  ) {
    nodeData.conditionalOperand = 'message';
  }
  if (typeof nodeData.conditionalVariable !== 'string') {
    nodeData.conditionalVariable = '';
  }
  if (!Array.isArray(nodeData.conditions)) {
    nodeData.conditions = [];
  }
  nodeData.conditions = nodeData.conditions.map((condition: any) => ({
    ...condition,
    valueType: ['string', 'number', 'boolean'].includes(condition?.valueType)
      ? condition.valueType
      : 'string',
  }));
};

const processWeekdayNodeData = (nodeData: any): void => {
  if (nodeData.timezone === undefined || !nodeData.timezone) {
    nodeData.timezone = WEEKDAY_NODE_DEFAULT_TIMEZONE;
  }

  nodeData.options = buildWeekdayOptions(
    Array.isArray(nodeData.options) ? nodeData.options : []
  );
};

const processHoursNodeData = (nodeData: any): void => {
  if (nodeData.timezone === undefined || !nodeData.timezone) {
    nodeData.timezone = HOURS_NODE_DEFAULT_TIMEZONE;
  }

  nodeData.options = buildHoursOptions(
    Array.isArray(nodeData.options) ? nodeData.options : []
  );
};

const processHolidayNodeData = (nodeData: any): void => {
  const options = Array.isArray(nodeData.options) ? nodeData.options : [];
  const isHolidayOption = options.find(
    (option: { id?: string }) => option?.id === HOLIDAY_IS_OPTION_ID
  );
  const notHolidayOption = options.find(
    (option: { id?: string }) => option?.id === HOLIDAY_NOT_OPTION_ID
  );

  nodeData.options = [
    {
      id: HOLIDAY_IS_OPTION_ID,
      text: isHolidayOption?.text || t('chatbot_holiday_option_is_holiday'),
      required: true,
    },
    {
      id: HOLIDAY_NOT_OPTION_ID,
      text: notHolidayOption?.text || t('chatbot_holiday_option_not_holiday'),
      required: true,
    },
  ];

  if (
    nodeData.holidayMessage === undefined ||
    nodeData.holidayMessage === null
  ) {
    nodeData.holidayMessage = '';
  }
};

const processOfficialNodeData = (node: Node): void => {
  if (!node.data) {
    node.data = {};
  }

  const nodeType = node.type as OfficialNodeType;
  const defaults = getOfficialDefaultData(nodeType);
  node.data = {
    ...defaults,
    ...node.data,
    officialType: node.type,
    official: {
      ...(node.data.official || {}),
      type: node.type,
    },
  };

  if (node.type === 'officialCtaUrl') {
    node.data.continueType = 'automatic';
  } else if (isOfficialWaitForResponseNodeType(node.type)) {
    node.data.continueType = 'after_response';
  }

  if (node.type === 'officialReplyButtons' || node.type === 'officialList') {
    processMenuNodeData(node.data);
  }

  if (node.data.message === undefined && node.data.text !== undefined) {
    node.data.message = node.data.text;
  }
  if (node.data.text === undefined && node.data.message !== undefined) {
    node.data.text = node.data.message;
  }

  if (node.type === 'officialTemplate') {
    if (!Array.isArray(node.data.templateVariables)) {
      node.data.templateVariables = [];
    }
    if (!node.data.templateLanguage) {
      node.data.templateLanguage = 'pt_BR';
    }
    if (!Array.isArray(node.data.templateComponents)) {
      node.data.templateComponents = [];
    }
    if (
      !node.data.templatePreview ||
      typeof node.data.templatePreview !== 'object' ||
      Array.isArray(node.data.templatePreview)
    ) {
      node.data.templatePreview = null;
    }
  }

  if (node.type === 'officialMultiProduct') {
    for (const arrayField of ['products', 'sections']) {
      if (!Array.isArray(node.data[arrayField])) {
        node.data[arrayField] = [];
      }
    }
  } else {
    delete node.data.products;
    delete node.data.sections;
  }

  if (node.type === 'officialMediaCarousel') {
    if (!Array.isArray(node.data.cards)) {
      node.data.cards = [];
    }
  } else {
    delete node.data.cards;
  }

  if (node.type === 'officialContacts') {
    if (!Array.isArray(node.data.contacts)) {
      node.data.contacts = [];
    }
  } else {
    delete node.data.contacts;
  }

  for (const objectField of ['parameters', 'action']) {
    if (
      !node.data[objectField] ||
      typeof node.data[objectField] !== 'object' ||
      Array.isArray(node.data[objectField])
    ) {
      node.data[objectField] = {};
    }
  }
};

const processNodeDataByType = (node: Node): void => {
  if (!node.data) {
    node.data = {};
  }

  if (isOfficialChatbotNodeType(node.type || '')) {
    processOfficialNodeData(node);
    return;
  }

  switch (node.type) {
    case 'menu':
      processMenuNodeData(node.data);
      break;
    case 'satisfaction':
      processSatisfactionNodeData(node.data);
      break;
    case 'contact':
      processMenuNodeData(node.data);
      break;
    case 'redirect':
      processRedirectNodeData(node.data);
      break;
    case 'tag':
      processTagNodeData(node.data);
      break;
    case 'message':
      processMessageNodeData(node.data);
      break;
    case 'randomMessage':
      processRandomMessageNodeData(node.data);
      break;
    case 'data':
      processDataNodeData(node.data);
      break;
    case 'underchat':
      processUnderchatNodeData(node.data);
      break;
    case 'aiAgent':
      processAiAgentNodeData(node.data);
      break;
    case 'annotation':
      processAnnotationNodeData(node.data);
      break;
    case 'distribution':
      processDistributionNodeData(node.data);
      break;
    case 'conditional':
      processConditionalNodeData(node.data);
      break;
    case 'weekday':
      processWeekdayNodeData(node.data);
      break;
    case 'hours':
      processHoursNodeData(node.data);
      break;
    case 'holiday':
      processHolidayNodeData(node.data);
      break;
    case 'apiRequest':
      processApiRequestNodeData(node.data);
      break;
  }
};

const processLoadedNode = (node: Node): Node => {
  if (node.type === 'start') {
    node.draggable = false;
    if (!node.data) {
      node.data = {};
    }
  } else {
    node.draggable = !isFlowReadOnly.value;
    if (!node.data) {
      node.data = {};
    }
    if (!isFlowReadOnly.value) {
      node.data.onRemove = () => removeNode(node.id);
    }

    if (
      node.type === 'menu' ||
      node.type === 'satisfaction' ||
      node.type === 'contact' ||
      node.type === 'aiAgent' ||
      node.type === 'hours' ||
      node.type === 'holiday' ||
      node.type === 'officialReplyButtons' ||
      node.type === 'officialList'
    ) {
      node.data.onRemoveOption = (optionId: string) =>
        removeOptionEdge(node.id, optionId);
    }

    if (node.type === 'conditional') {
      node.data.onRemoveCondition = (conditionId: string) =>
        removeConditionEdge(node.id, conditionId);
    }

    if (node.type === 'aiAgent') {
      node.data.onRemoveInteractionsEdge = () =>
        removeInteractionsEdge(node.id);
    }
  }

  processNodeDataByType(node);
  if (node.type === 'officialTemplate' && node.data) {
    applyOfficialTemplateContextToData(node.data as Record<string, any>);
  }
  if (node.type === 'apiRequest') {
    applyApiRequestRuntimeData(node);
  }
  if (node.type === 'underchat') {
    applyUnderchatRuntimeData(node);
  }
  return node;
};

const calculateMaxNodeId = (loadedNodes: Node[]): number => {
  return loadedNodes.reduce((max, node) => {
    let lastNumber = '';
    for (let i = node.id.length - 1; i >= 0; i--) {
      const char = node.id[i];
      if (char >= '0' && char <= '9') {
        lastNumber = char + lastNumber;
      } else if (lastNumber) {
        break;
      }
    }
    if (lastNumber) {
      const num = Number.parseInt(lastNumber, 10);
      return Math.max(max, num);
    }
    return max;
  }, 0);
};

const processLoadedNodes = (loadedNodes: Node[]): void => {
  apiUpstreamContractSignatures.clear();
  reservedApiOutputKeys.clear();
  reservedNodeOutputKeys.data.clear();
  reservedNodeOutputKeys.message.clear();
  reservedNodeOutputKeys.underchat.clear();

  for (const node of loadedNodes) {
    if (node.type === 'apiRequest') {
      const requestedKey = (
        node.data?.apiRequest as ApiRequestConfig | undefined
      )?.outputKey;
      if (
        typeof requestedKey === 'string' &&
        /^api_[1-9]\d*$/.test(requestedKey)
      ) {
        reservedApiOutputKeys.add(requestedKey);
      }
    }
    if (
      isChatbotCaptureNodeType(node.type) &&
      isChatbotNodeOutputKey(node.type, node.data?.outputKey)
    ) {
      reservedNodeOutputKeys[node.type].add(node.data.outputKey);
    }
  }

  const assignedApiOutputKeys = new Set<string>();
  const assignedNodeOutputKeys: Record<ChatbotCaptureNodeType, Set<string>> = {
    data: new Set<string>(),
    message: new Set<string>(),
    underchat: new Set<string>(),
  };
  for (const node of loadedNodes) {
    if (!node.data) node.data = {};
    if (isChatbotCaptureNodeType(node.type)) {
      const requestedKey = node.data.outputKey;
      const outputKey =
        isChatbotNodeOutputKey(node.type, requestedKey) &&
        !assignedNodeOutputKeys[node.type].has(requestedKey)
          ? requestedKey
          : allocateNodeOutputKey(node.type);
      node.data.outputKey = outputKey;
      assignedNodeOutputKeys[node.type].add(outputKey);
    }
    if (node.type === 'apiRequest') {
      const rawConfig = (node.data.apiRequest ||
        {}) as Partial<ApiRequestConfig>;
      const requestedKey = rawConfig.outputKey;
      const outputKey =
        typeof requestedKey === 'string' &&
        /^api_[1-9]\d*$/.test(requestedKey) &&
        !assignedApiOutputKeys.has(requestedKey)
          ? requestedKey
          : allocateApiOutputKey();
      node.data.apiRequest = normalizeApiRequestConfig(
        { ...rawConfig, outputKey },
        { outputKey }
      );
      assignedApiOutputKeys.add(outputKey);
    }
  }

  nodes.value = loadedNodes.map(processLoadedNode);
  const maxId = calculateMaxNodeId(loadedNodes);
  nodeIdCounter = maxId + 1;
};

const processLoadedEdges = (loadedEdges: Edge[]): void => {
  edges.value = loadedEdges.map((edge) => {
    const baseEdge: Edge = {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle ? String(edge.sourceHandle) : undefined,
      targetHandle: edge.targetHandle ? String(edge.targetHandle) : undefined,
      markerEnd:
        edge.markerEnd ||
        ({
          type: 'arrowclosed',
          color: '#1a192b',
        } as any),
      style: edge.style || {
        stroke: '#1a192b',
        strokeWidth: 2,
      },
      class: edge.class || '',
    } as any;

    return normalizeEdge(baseEdge);
  });
};

const loadChatbotFlow = async () => {
  if (!chatbotId.value) {
    return;
  }

  isFlowReadOnly.value = false;
  isLoadingFlow.value = true;

  try {
    const flow = await chatbotStore.listChatbotFlow(chatbotId.value);

    if (!flow) {
      return;
    }

    isFlowReadOnly.value = flow.read_only === true || flow.restricted === true;

    if (flow.nodes && flow.nodes.length > 0) {
      processLoadedNodes(flow.nodes as Node[]);
    } else {
      processLoadedNodes(
        initialNodes.map((node) => ({ ...node, data: { ...node.data } }))
      );
    }

    if (flow.edges && flow.edges.length > 0) {
      processLoadedEdges(flow.edges as Edge[]);
    } else {
      edges.value = [];
    }
  } catch (error) {
    console.error('Error loading flow:', error);
  } finally {
    isLoadingFlow.value = false;
  }
};

const loadOfficialCapabilities = async () => {
  if (!chatbotId.value) {
    officialCapabilities.value = null;
    officialTemplates.value = [];
    officialTemplatesError.value = null;
    syncOfficialTemplateContextToNodes();
    return;
  }

  officialCapabilities.value = await chatbotStore.listOfficialCapabilities(
    chatbotId.value
  );

  if (!canUseOfficialNodes.value) {
    officialTemplates.value = [];
    officialTemplatesError.value = null;
    syncOfficialTemplateContextToNodes();
    return;
  }

  await loadOfficialTemplates();
};

const loadOfficialTemplates = async () => {
  if (!chatbotId.value) {
    officialTemplates.value = [];
    officialTemplatesError.value = null;
    syncOfficialTemplateContextToNodes();
    return;
  }

  isLoadingOfficialTemplates.value = true;
  officialTemplatesError.value = null;
  syncOfficialTemplateContextToNodes();

  try {
    const response = await chatbotStore.listOfficialTemplates(chatbotId.value);
    officialTemplates.value = response ?? [];
    if (!response) {
      officialTemplatesError.value = t('official_templates_loading_error');
    }
  } catch {
    officialTemplates.value = [];
    officialTemplatesError.value = t('official_templates_loading_error');
  } finally {
    isLoadingOfficialTemplates.value = false;
    syncOfficialTemplateContextToNodes();
  }
};

const processInactivityAlertConfig = async (config: any): Promise<void> => {
  inactivityAlertStatus.value =
    (config.status as 'active' | 'inactive') || 'inactive';

  if (config.quantity) {
    inactivityAlertQuantity.value = config.quantity.toString();
  }
  if (config.time) {
    inactivityAlertTime.value = config.time.toString();
  }
  if (config.action) {
    inactivityAlertAction.value = config.action as 'redirect' | 'finish';
  }
  if (config.redirect_type) {
    inactivityAlertRedirectType.value =
      config.redirect_type as ChatbotInactivityRedirectType;
  }
  if (config.selected_user) {
    inactivityAlertSelectedUser.value = config.selected_user;
  }
  if (config.selected_sector) {
    inactivityAlertSelectedSector.value = config.selected_sector;
    await loadInactivitySectorUsers(config.selected_sector);
  }
  if (config.selected_sector_user) {
    inactivityAlertSelectedSectorUser.value = config.selected_sector_user;
  }
  await restoreInactivityChatbotSelection(
    config.selected_channel,
    config.selected_chatbot
  );
};

const processRedirectFailedAttemptsConfig = async (
  config: any
): Promise<void> => {
  redirectFailedAttemptsStatus.value =
    (config.status as 'active' | 'inactive') || 'inactive';

  if (config.quantity) {
    redirectFailedAttemptsQuantity.value = config.quantity.toString();
  }
  if (config.redirect_type) {
    redirectFailedAttemptsRedirectType.value = config.redirect_type as
      'user' | 'sector';
  }
  if (config.selected_user) {
    redirectFailedAttemptsSelectedUser.value = config.selected_user;
  }
  if (config.selected_sector) {
    redirectFailedAttemptsSelectedSector.value = config.selected_sector;
    await loadRedirectFailedAttemptsSectorUsers(config.selected_sector);
  }
  if (config.selected_sector_user) {
    redirectFailedAttemptsSelectedSectorUser.value =
      config.selected_sector_user;
  }
};

const loadInitialData = async (): Promise<void> => {
  await loadInactivitySectors();
  await loadInactivityUsers();
  await loadInactivityChannels();
  await loadRedirectFailedAttemptsSectors();
  await loadRedirectFailedAttemptsUsers();
};

const processConfigurations = async (configs: any): Promise<void> => {
  if (configs.inactivity_alert) {
    await processInactivityAlertConfig(configs.inactivity_alert);
  }

  if (configs.redirect_failed_attempts) {
    await processRedirectFailedAttemptsConfig(configs.redirect_failed_attempts);
  }

  if (configs.finish_triggers) {
    finishTriggers.value = Array.isArray(configs.finish_triggers)
      ? configs.finish_triggers
      : [];
  } else {
    finishTriggers.value = [];
  }

  triggerEvents.value = normalizeTriggerEvents(configs.trigger_events);

  if (configs.messages) {
    inactivityMessage.value = configs.messages.inactivity_message || '';
    invalidMenuOptionMessage.value =
      configs.messages.invalid_menu_option_message || '';
    invalidSatisfactionOptionMessage.value =
      configs.messages.invalid_satisfaction_option_message || '';
    invalidCpfMessage.value = configs.messages.invalid_cpf_message || '';
    invalidCnpjMessage.value = configs.messages.invalid_cnpj_message || '';
    invalidEmailMessage.value = configs.messages.invalid_email_message || '';
    serviceFinishedMessage.value =
      configs.messages.service_finished_message || '';
    transferMessageUser.value = configs.messages.transfer_message_user || '';
    transferMessageSector.value =
      configs.messages.transfer_message_sector || '';
    transferMessageSectorUser.value =
      configs.messages.transfer_message_sector_user || '';

    isInactivityMessageEnabled.value =
      configs.messages.inactivity_message_enabled !== false;
    isInvalidMenuOptionMessageEnabled.value =
      configs.messages.invalid_menu_option_message_enabled !== false;
    isInvalidSatisfactionOptionMessageEnabled.value =
      configs.messages.invalid_satisfaction_option_message_enabled !== false;
    isInvalidCpfMessageEnabled.value =
      configs.messages.invalid_cpf_message_enabled !== false;
    isInvalidCnpjMessageEnabled.value =
      configs.messages.invalid_cnpj_message_enabled !== false;
    isInvalidEmailMessageEnabled.value =
      configs.messages.invalid_email_message_enabled !== false;
    isServiceFinishedMessageEnabled.value =
      configs.messages.service_finished_message_enabled !== false;
    isTransferMessageUserEnabled.value =
      configs.messages.transfer_message_user_enabled !== false;
    isTransferMessageSectorEnabled.value =
      configs.messages.transfer_message_sector_enabled !== false;
    isTransferMessageSectorUserEnabled.value =
      configs.messages.transfer_message_sector_user_enabled !== false;
  } else {
    inactivityMessage.value = '';
    invalidMenuOptionMessage.value = '';
    invalidSatisfactionOptionMessage.value = '';
    invalidCpfMessage.value = '';
    invalidCnpjMessage.value = '';
    invalidEmailMessage.value = '';
    serviceFinishedMessage.value = '';
    transferMessageUser.value = '';
    transferMessageSector.value = '';
    transferMessageSectorUser.value = '';

    isInactivityMessageEnabled.value = true;
    isInvalidMenuOptionMessageEnabled.value = true;
    isInvalidSatisfactionOptionMessageEnabled.value = true;
    isInvalidCpfMessageEnabled.value = true;
    isInvalidCnpjMessageEnabled.value = true;
    isInvalidEmailMessageEnabled.value = true;
    isServiceFinishedMessageEnabled.value = true;
    isTransferMessageUserEnabled.value = true;
    isTransferMessageSectorEnabled.value = true;
    isTransferMessageSectorUserEnabled.value = true;
  }
};

const addFinishTrigger = () => {
  const text = finishTriggerInput.value.trim();
  if (!text) {
    return;
  }

  const words = text.split(/\s+/).filter((word) => word.length > 0);
  for (const word of words) {
    const normalizedWord = word.toLowerCase();
    if (
      !finishTriggers.value.some(
        (trigger) => trigger.toLowerCase() === normalizedWord
      )
    ) {
      finishTriggers.value.push(word);
    }
  }

  finishTriggerInput.value = '';
};

const removeFinishTrigger = (triggerToRemove: string) => {
  finishTriggers.value = finishTriggers.value.filter(
    (trigger) => trigger !== triggerToRemove
  );
};

const loadChatbotFlowConfigurations = async () => {
  if (!chatbotId.value) {
    return;
  }

  try {
    await loadInitialData();

    const configurations = await chatbotStore.listChatbotFlowConfigurations(
      chatbotId.value
    );

    if (configurations?.configurations) {
      await processConfigurations(configurations.configurations);
    }
  } catch (error) {
    console.error('Error loading configurations:', error);
  }
};

const handleSaveConfigurations = async () => {
  if (isFlowReadOnly.value) return;
  if (!chatbotId.value) {
    chatbotStore.showSnackbar(
      t('chatbot_flow_validation_chatbot_id_required'),
      EColor.error
    );
    return;
  }

  if (isInactivityAlertQuantityInvalid.value) {
    chatbotStore.showSnackbar(
      t('chatbot_flow_validation_inactivity_quantity_required'),
      EColor.error
    );
    return;
  }
  if (isInactivityAlertTimeInvalid.value) {
    chatbotStore.showSnackbar(
      t('chatbot_flow_validation_inactivity_time_required'),
      EColor.error
    );
    return;
  }

  if (
    isInactivityChatbotTargetIncomplete.value &&
    !inactivityAlertSelectedChannel.value
  ) {
    chatbotStore.showSnackbar(t('channel_required'), EColor.error);
    return;
  }
  if (isInactivityChatbotTargetIncomplete.value) {
    chatbotStore.showSnackbar(t('chatbot_required'), EColor.error);
    return;
  }

  try {
    isSavingConfigurations.value = true;
    const inactivityRedirectDestination =
      inactivityAlertRedirectType.value === 'user'
        ? {
            selected_user: inactivityAlertSelectedUser.value || undefined,
          }
        : inactivityAlertRedirectType.value === 'sector'
          ? {
              selected_sector: inactivityAlertSelectedSector.value || undefined,
              selected_sector_user:
                inactivityAlertSelectedSectorUser.value || undefined,
            }
          : inactivityAlertRedirectType.value === 'chatbot'
            ? {
                selected_channel:
                  inactivityAlertSelectedChannel.value || undefined,
                selected_chatbot:
                  inactivityAlertSelectedChatbot.value || undefined,
              }
            : {};
    const configurations = {
      inactivity_alert:
        inactivityAlertStatus.value === 'active'
          ? {
              status: inactivityAlertStatus.value,
              quantity: Number.parseInt(inactivityAlertQuantity.value),
              time: Number.parseInt(inactivityAlertTime.value),
              action: inactivityAlertAction.value || undefined,
              ...(inactivityAlertAction.value === 'redirect'
                ? {
                    redirect_type:
                      inactivityAlertRedirectType.value || undefined,
                    ...inactivityRedirectDestination,
                  }
                : {}),
            }
          : undefined,
      redirect_failed_attempts:
        redirectFailedAttemptsStatus.value === 'active'
          ? {
              status: redirectFailedAttemptsStatus.value,
              quantity: redirectFailedAttemptsQuantity.value
                ? Number.parseInt(redirectFailedAttemptsQuantity.value)
                : undefined,
              redirect_type:
                redirectFailedAttemptsRedirectType.value || undefined,
              selected_user:
                redirectFailedAttemptsSelectedUser.value || undefined,
              selected_sector:
                redirectFailedAttemptsSelectedSector.value || undefined,
              selected_sector_user:
                redirectFailedAttemptsSelectedSectorUser.value || undefined,
            }
          : undefined,
      finish_triggers:
        finishTriggers.value.length > 0 ? finishTriggers.value : undefined,
      trigger_events: [...triggerEvents.value],
      messages: {
        inactivity_message: inactivityMessage.value || undefined,
        invalid_menu_option_message:
          invalidMenuOptionMessage.value || undefined,
        invalid_satisfaction_option_message:
          invalidSatisfactionOptionMessage.value || undefined,
        invalid_cpf_message: invalidCpfMessage.value || undefined,
        invalid_cnpj_message: invalidCnpjMessage.value || undefined,
        invalid_email_message: invalidEmailMessage.value || undefined,
        service_finished_message: serviceFinishedMessage.value || undefined,
        transfer_message_user: transferMessageUser.value || undefined,
        transfer_message_sector: transferMessageSector.value || undefined,
        transfer_message_sector_user:
          transferMessageSectorUser.value || undefined,
        inactivity_message_enabled: isInactivityMessageEnabled.value,
        invalid_menu_option_message_enabled:
          isInvalidMenuOptionMessageEnabled.value,
        invalid_satisfaction_option_message_enabled:
          isInvalidSatisfactionOptionMessageEnabled.value,
        invalid_cpf_message_enabled: isInvalidCpfMessageEnabled.value,
        invalid_cnpj_message_enabled: isInvalidCnpjMessageEnabled.value,
        invalid_email_message_enabled: isInvalidEmailMessageEnabled.value,
        service_finished_message_enabled: isServiceFinishedMessageEnabled.value,
        transfer_message_user_enabled: isTransferMessageUserEnabled.value,
        transfer_message_sector_enabled: isTransferMessageSectorEnabled.value,
        transfer_message_sector_user_enabled:
          isTransferMessageSectorUserEnabled.value,
      },
    };

    const result = await chatbotStore.saveChatbotFlowConfigurations({
      chatbot_id: chatbotId.value,
      configurations,
    });

    if (result) {
      closeConfigModal();
    }
  } catch (error) {
    console.error('Error saving configurations:', error);
  } finally {
    isSavingConfigurations.value = false;
  }
};

const handleCancel = () => {
  router.push('/chatbot');
};

const handleDocumentClick = (event: MouseEvent) => {
  if (!isContextMenuOpen.value) {
    return;
  }

  const target = event.target as HTMLElement;
  const isClickInsideCard =
    contextMenuCard.value && contextMenuCard.value.contains(target);
  const isClickOnEdge = target.closest('.vue-flow__edge');
  const isClickOnListItem = target.closest('.v-list-item');

  if (isClickInsideCard || isClickOnListItem) {
    return;
  }

  if (!isClickOnEdge) {
    isContextMenuOpen.value = false;
    contextMenuPosition.value = null;
  }
};

onMounted(() => {
  loadOfficialCapabilities();
  loadChatbotFlow();
  window.addEventListener('keydown', handleDeleteKey);
  document.addEventListener('click', handleDocumentClick, true);
  defaultTransferMessageUserText.value = t(
    'chatbot_transfer_message_user_default',
    {
      user: '{{ user }}',
    }
  );
  defaultTransferMessageSectorText.value = t(
    'chatbot_transfer_message_sector_default',
    {
      sector: '{{ sector }}',
    }
  );
  defaultTransferMessageSectorUserText.value = t(
    'chatbot_transfer_message_sector_user_default',
    {
      user: '{{ user }}',
      sector: '{{ sector }}',
    }
  );
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleDeleteKey);
  document.removeEventListener('click', handleDocumentClick, true);
});
</script>

<template>
  <div>
    <VCard class="chatbot-flow-workspace">
      <header class="workspace-header">
        <div class="workspace-heading">
          <span class="workspace-heading__icon" aria-hidden="true">
            <VIcon icon="tabler-message-chatbot" size="24" />
          </span>
          <div>
            <p class="workspace-heading__eyebrow">{{ t('chatbot') }}</p>
            <h1 class="workspace-heading__title">
              {{ t('configurations') }} {{ t('chatbot') }}
            </h1>
            <p class="workspace-heading__subtitle">
              {{ t('chatbot_flow_workspace_subtitle') }}
            </p>
          </div>
        </div>

        <div class="workspace-actions">
          <VBtn
            variant="tonal"
            color="secondary"
            data-testid="chatbot-flow-settings"
            :disabled="isFlowReadOnly"
            @click="openConfigModal"
          >
            <VIcon icon="tabler-settings" class="me-2" />
            {{ t('chatbot_configurations') }}
          </VBtn>
          <VBtn
            variant="tonal"
            color="info"
            data-testid="chatbot-flow-variables"
            @click="isVariablesSidebarOpen = true"
          >
            <VIcon icon="tabler-code" class="me-2" />
            {{ t('chatbot_message_variables_legend') }}
          </VBtn>
          <VBtn variant="tonal" color="secondary" @click="handleCancel">
            {{ t('cancel') }}
          </VBtn>
          <VBtn
            color="primary"
            :loading="isLoadingFlow"
            :disabled="!chatbotId || isFlowReadOnly"
            @click="handleSave"
          >
            {{ t('save') }}
          </VBtn>
        </div>
      </header>

      <VDivider />

      <VCardText class="workspace-body">
        <div class="flow-layout">
          <div
            ref="flowArea"
            class="flow-area"
            :class="{ 'flow-area--read-only': isFlowReadOnly }"
            data-testid="chatbot-flow-canvas"
          >
            <div class="flow-canvas-surface" :inert="isFlowReadOnly">
              <VueFlow
                ref="vueFlowRef"
                v-model:nodes="nodes"
                v-model:edges="edges"
                :node-types="nodeTypes"
                :min-zoom="0.2"
                :max-zoom="4"
                :default-viewport="{ zoom: 1 }"
                :connection-line-style="{ stroke: '#1a192b', strokeWidth: 2 }"
                :default-edge-options="{
                  markerEnd: {
                    type: 'arrowclosed',
                    color: '#1a192b',
                  } as any,
                  style: { stroke: '#1a192b', strokeWidth: 2 },
                }"
                :connection-radius="20"
                :nodes-draggable="!isFlowReadOnly"
                :nodes-connectable="!isFlowReadOnly"
                :edges-updatable="!isFlowReadOnly"
                :delete-key-code="isFlowReadOnly ? null : 'Backspace'"
                :is-valid-connection="isValidConnection"
                @connect="onConnect"
                @nodes-change="onNodesChange"
                @drop="onDrop"
                @dragover.prevent
                @edge-click="onEdgeClick"
                @edge-context-menu="onEdgeContextMenu"
                @pane-click="onPaneClick"
              />
            </div>

            <div
              v-if="isFlowReadOnly"
              class="flow-read-only-notice"
              role="status"
            >
              <VIcon icon="tabler-shield-lock" size="17" />
              <span>{{ t('chatbot_underchat_flow_read_only') }}</span>
            </div>

            <div
              class="flow-toolbar"
              role="group"
              :aria-label="t('chatbot_flow_canvas_help')"
            >
              <VTooltip location="end">
                <template #activator="{ props }">
                  <VBtn
                    v-bind="props"
                    icon="tabler-minus"
                    variant="text"
                    size="small"
                    :aria-label="t('chatbot_flow_zoom_out')"
                    @click="zoomOutFlow"
                  />
                </template>
                {{ t('chatbot_flow_zoom_out') }}
              </VTooltip>
              <VTooltip location="end">
                <template #activator="{ props }">
                  <VBtn
                    v-bind="props"
                    icon="tabler-focus-centered"
                    variant="text"
                    size="small"
                    :aria-label="t('chatbot_flow_fit_view')"
                    @click="fitFlowView"
                  />
                </template>
                {{ t('chatbot_flow_fit_view') }}
              </VTooltip>
              <VTooltip location="end">
                <template #activator="{ props }">
                  <VBtn
                    v-bind="props"
                    icon="tabler-plus"
                    variant="text"
                    size="small"
                    :aria-label="t('chatbot_flow_zoom_in')"
                    @click="zoomInFlow"
                  />
                </template>
                {{ t('chatbot_flow_zoom_in') }}
              </VTooltip>
            </div>

            <ChatbotNodePalette
              v-if="!isFlowReadOnly"
              :items="nodePaletteItems"
              :categories="nodePaletteCategories"
              :container-element="flowAreaRef"
              :storage-key="nodePaletteStorageKey"
              :is-mobile="isMobilePalette"
              @create="onPaletteCreate"
              @drag-start="onPaletteDragStart"
              @drag-end="onPaletteDragEnd"
            />
          </div>
        </div>
      </VCardText>
    </VCard>

    <VNavigationDrawer
      v-model="isVariablesSidebarOpen"
      data-allow-mismatch
      temporary
      touchless
      absolute
      class="variables-sidebar"
      location="end"
      width="400"
    >
      <div class="d-flex flex-column" style="height: 100%">
        <div class="d-flex align-center pa-4 border-b">
          <IconBtn class="me-2" @click="isVariablesSidebarOpen = false">
            <VIcon icon="tabler-x" />
          </IconBtn>
          <h6 class="text-h6">{{ t('chatbot_message_variables_legend') }}</h6>
        </div>
        <div class="pa-4 flex-grow-1" style="overflow-y: auto">
          <p class="text-body-2 text-medium-emphasis mb-4">
            {{ t('chatbot_message_variables_legend_description') }}
          </p>
          <div class="d-flex flex-column gap-3">
            <div
              v-for="variable in availableVariables"
              :key="variable.tag"
              class="d-flex flex-column gap-1"
            >
              <code
                class="text-primary font-weight-bold text-body-1"
                style="display: block; margin: 0; padding: 0; line-height: 1.5"
                >{{ variable.tag }}</code
              >
              <span
                class="text-body-2 text-medium-emphasis"
                style="display: block; margin: 0; padding: 0; line-height: 1.5"
                >{{ variable.description }}</span
              >
            </div>
          </div>
        </div>
      </div>
    </VNavigationDrawer>

    <VDialog v-model="isConfigModalOpen" max-width="1000" persistent>
      <DialogCloseBtn @click="closeConfigModal" />

      <VCard :title="t('chatbot_configurations')">
        <VCardText class="pb-0">
          <VTabs v-model="configTab">
            <VTab value="resources">{{ t('resources') }}</VTab>
            <VTab value="messages">{{ t('messages') }}</VTab>
          </VTabs>
        </VCardText>

        <VDivider />

        <VCardText>
          <VWindow v-model="configTab">
            <VWindowItem value="resources">
              <template v-if="isLoadingConfigurations">
                <VCard variant="outlined" class="mb-4">
                  <VCardTitle class="pa-3 pb-0">
                    <VSkeletonLoader type="text" width="200" />
                  </VCardTitle>
                  <VCardSubtitle class="pa-3 pb-0 pt-2">
                    <VSkeletonLoader type="text" width="80%" />
                  </VCardSubtitle>
                  <VDivider />
                  <VCardText>
                    <div class="mb-3">
                      <VSkeletonLoader
                        type="text"
                        width="120"
                        height="20"
                        class="mb-2"
                      />
                      <VSkeletonLoader type="text" width="100%" height="40" />
                    </div>
                    <div class="mb-3">
                      <VSkeletonLoader
                        type="text"
                        width="150"
                        height="20"
                        class="mb-2"
                      />
                      <VSkeletonLoader type="text" width="100%" height="40" />
                    </div>
                    <div class="mb-3">
                      <VSkeletonLoader
                        type="text"
                        width="100"
                        height="20"
                        class="mb-2"
                      />
                      <VSkeletonLoader type="text" width="100%" height="40" />
                    </div>
                  </VCardText>
                </VCard>
                <VCard variant="outlined" class="mb-4">
                  <VCardTitle class="pa-3 pb-0">
                    <VSkeletonLoader type="text" width="250" />
                  </VCardTitle>
                  <VCardSubtitle class="pa-3 pb-0 pt-2">
                    <VSkeletonLoader type="text" width="90%" />
                  </VCardSubtitle>
                  <VDivider />
                  <VCardText>
                    <div class="mb-3">
                      <VSkeletonLoader
                        type="text"
                        width="180"
                        height="20"
                        class="mb-2"
                      />
                      <VSkeletonLoader type="text" width="100%" height="40" />
                    </div>
                    <div class="mb-3">
                      <VSkeletonLoader
                        type="text"
                        width="120"
                        height="20"
                        class="mb-2"
                      />
                      <VSkeletonLoader type="text" width="100%" height="40" />
                    </div>
                  </VCardText>
                </VCard>
                <VCard variant="outlined" class="mb-4">
                  <VCardTitle class="pa-3 pb-0">
                    <VSkeletonLoader type="text" width="180" />
                  </VCardTitle>
                  <VCardSubtitle class="pa-3 pb-0 pt-2">
                    <VSkeletonLoader type="text" width="85%" />
                  </VCardSubtitle>
                  <VDivider />
                  <VCardText>
                    <div class="mb-3">
                      <VSkeletonLoader
                        type="text"
                        width="160"
                        height="20"
                        class="mb-2"
                      />
                      <VSkeletonLoader type="text" width="100%" height="40" />
                    </div>
                  </VCardText>
                </VCard>
              </template>
              <template v-else>
                <ChatbotInactivityAlertConfig
                  :status="inactivityAlertStatus"
                  :quantity="inactivityAlertQuantity"
                  :time="inactivityAlertTime"
                  :quantity-error="inactivityAlertQuantityError"
                  :time-error="inactivityAlertTimeError"
                  :action="inactivityAlertAction"
                  :redirect-type="inactivityAlertRedirectType"
                  :selected-user="inactivityAlertSelectedUser"
                  :selected-sector="inactivityAlertSelectedSector"
                  :selected-sector-user="inactivityAlertSelectedSectorUser"
                  :selected-channel="inactivityAlertSelectedChannel"
                  :selected-chatbot="inactivityAlertSelectedChatbot"
                  :users="inactivityUsers"
                  :sectors="inactivitySectors"
                  :sector-users="inactivitySectorUsers"
                  :channels="inactivityChannels"
                  :chatbots="inactivityChatbots"
                  :loading-users="isLoadingInactivityUsers"
                  :loading-sectors="isLoadingInactivitySectors"
                  :loading-sector-users="isLoadingInactivitySectorUsers"
                  :loading-channels="isLoadingInactivityChannels"
                  :loading-chatbots="isLoadingInactivityChatbots"
                  @update:status="inactivityAlertStatus = $event"
                  @update:quantity="inactivityAlertQuantity = $event"
                  @update:time="inactivityAlertTime = $event"
                  @update:action="inactivityAlertAction = $event"
                  @update:redirect-type="inactivityAlertRedirectType = $event"
                  @update:selected-user="inactivityAlertSelectedUser = $event"
                  @update:selected-sector="
                    inactivityAlertSelectedSector = $event
                  "
                  @update:selected-sector-user="
                    inactivityAlertSelectedSectorUser = $event
                  "
                  @update:selected-channel="handleInactivityChannelChange"
                  @update:selected-chatbot="
                    inactivityAlertSelectedChatbot = $event
                  "
                  @refresh-users="loadInactivityUsers"
                  @refresh-sectors="loadInactivitySectors"
                  @refresh-sector-users="loadInactivitySectorUsers"
                />
                <VCard variant="outlined" class="mb-4">
                  <VCardTitle class="text-body-1 pa-3 pb-0 font-weight-bold">
                    {{ t('chatbot_redirect_failed_attempts') }}
                  </VCardTitle>
                  <VCardSubtitle
                    class="text-caption pa-3 pb-0 pt-0 config-description"
                  >
                    {{ t('chatbot_redirect_failed_attempts_description') }}
                  </VCardSubtitle>
                  <VDivider />
                  <VCardText>
                    <div class="mb-3">
                      <VLabel class="mb-1 text-body-2">{{
                        t('chatbot_redirect_failed_attempts')
                      }}</VLabel>
                      <AppSelectSearch
                        v-model="redirectFailedAttemptsStatus"
                        :items="[
                          {
                            id: 'active',
                            title: t('chatbot_redirect_failed_attempts_active'),
                          },
                          {
                            id: 'inactive',
                            title: t(
                              'chatbot_redirect_failed_attempts_inactive'
                            ),
                          },
                        ]"
                        item-value="id"
                        item-title="title"
                        :clearable="false"
                      />
                    </div>

                    <div v-if="showRedirectFailedAttemptsFields">
                      <div class="mb-3">
                        <VLabel class="mb-1 text-body-2">{{
                          t('chatbot_redirect_failed_attempts_quantity')
                        }}</VLabel>
                        <VTextField
                          v-model="redirectFailedAttemptsQuantityComputed"
                          @keydown="onKeyPress"
                          @paste.prevent="
                            (e: ClipboardEvent) => {
                              const pastedText =
                                e.clipboardData?.getData('text') || '';
                              const numericValue = onlyDigits(pastedText);
                              if (numericValue) {
                                redirectFailedAttemptsQuantityComputed =
                                  numericValue;
                              }
                            }
                          "
                          variant="outlined"
                          density="compact"
                          hide-details
                          inputmode="numeric"
                          type="text"
                        />
                      </div>

                      <div class="mb-3">
                        <VLabel class="mb-1 text-body-2">{{
                          t('chatbot_redirect_to')
                        }}</VLabel>
                        <AppSelectSearch
                          v-model="redirectFailedAttemptsRedirectType"
                          :items="[
                            { id: 'user', title: t('chatbot_redirect_user') },
                            {
                              id: 'sector',
                              title: t('chatbot_redirect_sector'),
                            },
                          ]"
                          item-value="id"
                          item-title="title"
                          :clearable="false"
                        />
                      </div>

                      <div
                        v-if="showRedirectFailedAttemptsUserField"
                        class="mb-3"
                      >
                        <AppSelectSearch
                          v-model="redirectFailedAttemptsSelectedUser"
                          :items="redirectFailedAttemptsUsers"
                          :label="t('chatbot_user_label')"
                          :placeholder="t('chatbot_search')"
                          :loading="isLoadingRedirectFailedAttemptsUsers"
                          :clearable="true"
                          item-value="value"
                          item-title="title"
                          @select="loadRedirectFailedAttemptsUsers()"
                        >
                          <template #item-prepend="{ item }">
                            <VAvatar
                              size="32"
                              :variant="!item.photo ? 'tonal' : undefined"
                              color="primary"
                            >
                              <VImg
                                v-if="item.photo"
                                :src="item.photo"
                                :alt="item.title"
                              />
                              <VIcon v-else icon="tabler-user" size="18" />
                            </VAvatar>
                          </template>
                        </AppSelectSearch>
                      </div>

                      <div
                        v-if="showRedirectFailedAttemptsSectorField"
                        class="mb-3"
                      >
                        <AppSelectSearch
                          v-model="redirectFailedAttemptsSelectedSector"
                          :items="redirectFailedAttemptsSectors"
                          :label="t('chatbot_sector_label')"
                          :placeholder="t('chatbot_search')"
                          :loading="isLoadingRedirectFailedAttemptsSectors"
                          :clearable="true"
                          item-value="value"
                          item-title="title"
                          @select="loadRedirectFailedAttemptsSectors()"
                        >
                          <template #item-prepend="{ item }">
                            <VAvatar
                              size="24"
                              :style="{
                                backgroundColor: item.color || '#1976D2',
                              }"
                            />
                          </template>
                        </AppSelectSearch>
                      </div>

                      <div
                        v-if="showRedirectFailedAttemptsSectorUserField"
                        class="mb-3"
                      >
                        <AppSelectSearch
                          v-model="redirectFailedAttemptsSelectedSectorUser"
                          :items="redirectFailedAttemptsSectorUsers"
                          :label="t('chatbot_sector_user_label')"
                          :placeholder="t('chatbot_search_optional')"
                          :loading="isLoadingRedirectFailedAttemptsSectorUsers"
                          :clearable="true"
                          item-value="value"
                          item-title="title"
                          @select="
                            redirectFailedAttemptsSelectedSector
                              ? loadRedirectFailedAttemptsSectorUsers(
                                  redirectFailedAttemptsSelectedSector
                                )
                              : undefined
                          "
                        >
                          <template #item-prepend="{ item }">
                            <VAvatar
                              size="32"
                              :variant="!item.photo ? 'tonal' : undefined"
                              color="primary"
                            >
                              <VImg
                                v-if="item.photo"
                                :src="item.photo"
                                :alt="item.title"
                              />
                              <VIcon v-else icon="tabler-user" size="18" />
                            </VAvatar>
                          </template>
                        </AppSelectSearch>
                      </div>
                    </div>
                  </VCardText>
                </VCard>

                <VCard variant="outlined" class="mb-4">
                  <VCardTitle class="text-body-1 pa-3 pb-0 font-weight-bold">
                    {{ t('chatbot_trigger_events') }}
                  </VCardTitle>
                  <VCardSubtitle
                    class="text-caption pa-3 pb-0 pt-0 config-description"
                  >
                    {{ t('chatbot_trigger_events_description') }}
                  </VCardSubtitle>
                  <VDivider />
                  <VCardText>
                    <div class="d-flex flex-column gap-2 mb-3">
                      <VCheckbox
                        v-for="option in triggerEventOptions"
                        :key="option.value"
                        v-model="triggerEvents"
                        :label="option.label"
                        :value="option.value"
                        color="primary"
                        density="compact"
                        hide-details
                      />
                    </div>
                    <div class="text-caption text-medium-emphasis">
                      {{ t('chatbot_trigger_events_hint') }}
                    </div>
                  </VCardText>
                </VCard>

                <VCard variant="outlined" class="mb-4">
                  <VCardTitle class="text-body-1 pa-3 pb-0 font-weight-bold">
                    {{ t('chatbot_finish_triggers') }}
                  </VCardTitle>
                  <VCardSubtitle
                    class="text-caption pa-3 pb-0 pt-0 config-description"
                  >
                    {{ t('chatbot_finish_triggers_description') }}
                  </VCardSubtitle>
                  <VDivider />
                  <VCardText>
                    <div class="mb-3">
                      <VLabel class="mb-1 text-body-2">{{
                        t('chatbot_finish_triggers_label')
                      }}</VLabel>
                      <VTextField
                        v-model="finishTriggerInput"
                        :placeholder="t('chatbot_finish_triggers_placeholder')"
                        variant="outlined"
                        density="compact"
                        hide-details
                        @keydown.enter.prevent="addFinishTrigger"
                      />
                      <div class="text-caption text-medium-emphasis mt-2">
                        {{ t('chatbot_finish_triggers_hint') }}
                      </div>
                    </div>

                    <div
                      v-if="finishTriggers.length > 0"
                      class="d-flex flex-wrap gap-2"
                    >
                      <VChip
                        v-for="trigger in finishTriggers"
                        :key="trigger"
                        closable
                        @click:close="removeFinishTrigger(trigger)"
                        color="primary"
                        variant="tonal"
                      >
                        {{ trigger }}
                      </VChip>
                    </div>
                  </VCardText>
                </VCard>
              </template>
            </VWindowItem>

            <VWindowItem value="messages">
              <template v-if="isLoadingConfigurations">
                <div class="d-flex flex-column gap-4">
                  <VCard
                    v-for="i in 9"
                    :key="`skeleton-message-${i}`"
                    variant="outlined"
                  >
                    <VCardTitle
                      class="pa-3 pb-0 d-flex align-center justify-space-between"
                    >
                      <VSkeletonLoader type="text" width="200" />
                      <VSkeletonLoader type="button" width="40" height="24" />
                    </VCardTitle>
                    <VCardSubtitle class="pa-3 pb-0 pt-2">
                      <VSkeletonLoader type="text" width="90%" />
                    </VCardSubtitle>
                    <VDivider />
                    <VCardText>
                      <VSkeletonLoader type="sentences" class="mb-2" />
                      <VSkeletonLoader type="text" width="60%" height="16" />
                    </VCardText>
                  </VCard>
                </div>
              </template>
              <template v-else>
                <div class="d-flex flex-column gap-4">
                  <VCard variant="outlined">
                    <VCardTitle
                      class="text-body-1 pa-3 pb-0 font-weight-bold d-flex align-center justify-space-between"
                    >
                      <span>{{ t('chatbot_message_inactivity') }}</span>
                      <VSwitch
                        v-model="isInactivityMessageEnabled"
                        color="primary"
                        density="compact"
                        hide-details
                      />
                    </VCardTitle>
                    <VCardSubtitle
                      class="text-caption pa-3 pb-0 pt-0 config-description"
                    >
                      {{ t('chatbot_message_inactivity_description') }}
                    </VCardSubtitle>
                    <VDivider />
                    <VCardText>
                      <VTextarea
                        v-model="inactivityMessage"
                        :placeholder="defaultInactivityMessage"
                        :disabled="!isInactivityMessageEnabled"
                        variant="outlined"
                        density="compact"
                        hide-details
                        rows="3"
                      />
                      <div class="text-caption text-medium-emphasis mt-2">
                        <strong
                          >{{ t('chatbot_message_default_label') }}:
                        </strong>
                        {{ defaultInactivityMessage }}
                      </div>
                    </VCardText>
                  </VCard>

                  <VCard variant="outlined">
                    <VCardTitle
                      class="text-body-1 pa-3 pb-0 font-weight-bold d-flex align-center justify-space-between"
                    >
                      <span>{{
                        t('chatbot_message_invalid_menu_option')
                      }}</span>
                      <VSwitch
                        v-model="isInvalidMenuOptionMessageEnabled"
                        color="primary"
                        density="compact"
                        hide-details
                      />
                    </VCardTitle>
                    <VCardSubtitle
                      class="text-caption pa-3 pb-0 pt-0 config-description"
                    >
                      {{ t('chatbot_message_invalid_menu_option_description') }}
                    </VCardSubtitle>
                    <VDivider />
                    <VCardText>
                      <VTextarea
                        v-model="invalidMenuOptionMessage"
                        :placeholder="defaultInvalidMenuOptionMessage"
                        :disabled="!isInvalidMenuOptionMessageEnabled"
                        variant="outlined"
                        density="compact"
                        hide-details
                        rows="3"
                      />
                      <div class="text-caption text-medium-emphasis mt-2">
                        <strong
                          >{{ t('chatbot_message_default_label') }}:
                        </strong>
                        {{ defaultInvalidMenuOptionMessage }}
                      </div>
                    </VCardText>
                  </VCard>

                  <VCard variant="outlined">
                    <VCardTitle
                      class="text-body-1 pa-3 pb-0 font-weight-bold d-flex align-center justify-space-between"
                    >
                      <span>{{
                        t('chatbot_message_invalid_satisfaction_option')
                      }}</span>
                      <VSwitch
                        v-model="isInvalidSatisfactionOptionMessageEnabled"
                        color="primary"
                        density="compact"
                        hide-details
                      />
                    </VCardTitle>
                    <VCardSubtitle
                      class="text-caption pa-3 pb-0 pt-0 config-description"
                    >
                      {{
                        t(
                          'chatbot_message_invalid_satisfaction_option_description'
                        )
                      }}
                    </VCardSubtitle>
                    <VDivider />
                    <VCardText>
                      <VTextarea
                        v-model="invalidSatisfactionOptionMessage"
                        :placeholder="defaultInvalidSatisfactionOptionMessage"
                        :disabled="!isInvalidSatisfactionOptionMessageEnabled"
                        variant="outlined"
                        density="compact"
                        hide-details
                        rows="3"
                      />
                      <div class="text-caption text-medium-emphasis mt-2">
                        <strong
                          >{{ t('chatbot_message_default_label') }}:
                        </strong>
                        {{ defaultInvalidSatisfactionOptionMessage }}
                      </div>
                    </VCardText>
                  </VCard>

                  <VCard variant="outlined">
                    <VCardTitle
                      class="text-body-1 pa-3 pb-0 font-weight-bold d-flex align-center justify-space-between"
                    >
                      <span>{{ t('chatbot_message_invalid_cpf') }}</span>
                      <VSwitch
                        v-model="isInvalidCpfMessageEnabled"
                        color="primary"
                        density="compact"
                        hide-details
                      />
                    </VCardTitle>
                    <VCardSubtitle
                      class="text-caption pa-3 pb-0 pt-0 config-description"
                    >
                      {{ t('chatbot_message_invalid_cpf_description') }}
                    </VCardSubtitle>
                    <VDivider />
                    <VCardText>
                      <VTextarea
                        v-model="invalidCpfMessage"
                        :placeholder="defaultInvalidCpfMessage"
                        :disabled="!isInvalidCpfMessageEnabled"
                        variant="outlined"
                        density="compact"
                        hide-details
                        rows="3"
                      />
                      <div class="text-caption text-medium-emphasis mt-2">
                        <strong
                          >{{ t('chatbot_message_default_label') }}:
                        </strong>
                        {{ defaultInvalidCpfMessage }}
                      </div>
                    </VCardText>
                  </VCard>

                  <VCard variant="outlined">
                    <VCardTitle
                      class="text-body-1 pa-3 pb-0 font-weight-bold d-flex align-center justify-space-between"
                    >
                      <span>{{ t('chatbot_message_invalid_cnpj') }}</span>
                      <VSwitch
                        v-model="isInvalidCnpjMessageEnabled"
                        color="primary"
                        density="compact"
                        hide-details
                      />
                    </VCardTitle>
                    <VCardSubtitle
                      class="text-caption pa-3 pb-0 pt-0 config-description"
                    >
                      {{ t('chatbot_message_invalid_cnpj_description') }}
                    </VCardSubtitle>
                    <VDivider />
                    <VCardText>
                      <VTextarea
                        v-model="invalidCnpjMessage"
                        :placeholder="defaultInvalidCnpjMessage"
                        :disabled="!isInvalidCnpjMessageEnabled"
                        variant="outlined"
                        density="compact"
                        hide-details
                        rows="3"
                      />
                      <div class="text-caption text-medium-emphasis mt-2">
                        <strong
                          >{{ t('chatbot_message_default_label') }}:
                        </strong>
                        {{ defaultInvalidCnpjMessage }}
                      </div>
                    </VCardText>
                  </VCard>

                  <VCard variant="outlined">
                    <VCardTitle
                      class="text-body-1 pa-3 pb-0 font-weight-bold d-flex align-center justify-space-between"
                    >
                      <span>{{ t('chatbot_message_invalid_email') }}</span>
                      <VSwitch
                        v-model="isInvalidEmailMessageEnabled"
                        color="primary"
                        density="compact"
                        hide-details
                      />
                    </VCardTitle>
                    <VCardSubtitle
                      class="text-caption pa-3 pb-0 pt-0 config-description"
                    >
                      {{ t('chatbot_message_invalid_email_description') }}
                    </VCardSubtitle>
                    <VDivider />
                    <VCardText>
                      <VTextarea
                        v-model="invalidEmailMessage"
                        :placeholder="defaultInvalidEmailMessage"
                        :disabled="!isInvalidEmailMessageEnabled"
                        variant="outlined"
                        density="compact"
                        hide-details
                        rows="3"
                      />
                      <div class="text-caption text-medium-emphasis mt-2">
                        <strong
                          >{{ t('chatbot_message_default_label') }}:
                        </strong>
                        {{ defaultInvalidEmailMessage }}
                      </div>
                    </VCardText>
                  </VCard>

                  <VCard variant="outlined">
                    <VCardTitle
                      class="text-body-1 pa-3 pb-0 font-weight-bold d-flex align-center justify-space-between"
                    >
                      <span>{{ t('chatbot_message_service_finished') }}</span>
                      <VSwitch
                        v-model="isServiceFinishedMessageEnabled"
                        color="primary"
                        density="compact"
                        hide-details
                      />
                    </VCardTitle>
                    <VCardSubtitle
                      class="text-caption pa-3 pb-0 pt-0 config-description"
                    >
                      {{ t('chatbot_message_service_finished_description') }}
                    </VCardSubtitle>
                    <VDivider />
                    <VCardText>
                      <VTextarea
                        v-model="serviceFinishedMessage"
                        :placeholder="defaultServiceFinishedMessage"
                        :disabled="!isServiceFinishedMessageEnabled"
                        variant="outlined"
                        density="compact"
                        hide-details
                        rows="3"
                      />
                      <div class="text-caption text-medium-emphasis mt-2">
                        <strong
                          >{{ t('chatbot_message_default_label') }}:
                        </strong>
                        {{ defaultServiceFinishedMessage }}
                      </div>
                    </VCardText>
                  </VCard>

                  <VCard variant="outlined">
                    <VCardTitle
                      class="text-body-1 pa-3 pb-0 font-weight-bold d-flex align-center justify-space-between"
                    >
                      <span>{{ t('chatbot_message_transfer_user') }}</span>
                      <VSwitch
                        v-model="isTransferMessageUserEnabled"
                        color="primary"
                        density="compact"
                        hide-details
                      />
                    </VCardTitle>
                    <VCardSubtitle
                      class="text-caption pa-3 pb-0 pt-0 config-description"
                    >
                      {{ t('chatbot_message_transfer_user_description') }}
                    </VCardSubtitle>
                    <VDivider />
                    <VCardText>
                      <VTextarea
                        v-model="transferMessageUser"
                        v-bind:placeholder="safeDefaultTransferMessageUserText"
                        :disabled="!isTransferMessageUserEnabled"
                        variant="outlined"
                        density="compact"
                        hide-details
                        rows="3"
                      />
                      <div class="text-caption text-medium-emphasis mt-2">
                        <strong
                          >{{ t('chatbot_message_default_label') }}:
                        </strong>
                        <span
                          v-text="safeDefaultTransferMessageUserText"
                        ></span>
                      </div>
                    </VCardText>
                  </VCard>

                  <VCard variant="outlined">
                    <VCardTitle
                      class="text-body-1 pa-3 pb-0 font-weight-bold d-flex align-center justify-space-between"
                    >
                      <span>{{ t('chatbot_message_transfer_sector') }}</span>
                      <VSwitch
                        v-model="isTransferMessageSectorEnabled"
                        color="primary"
                        density="compact"
                        hide-details
                      />
                    </VCardTitle>
                    <VCardSubtitle
                      class="text-caption pa-3 pb-0 pt-0 config-description"
                    >
                      {{ t('chatbot_message_transfer_sector_description') }}
                    </VCardSubtitle>
                    <VDivider />
                    <VCardText>
                      <VTextarea
                        v-model="transferMessageSector"
                        v-bind:placeholder="
                          safeDefaultTransferMessageSectorText
                        "
                        :disabled="!isTransferMessageSectorEnabled"
                        variant="outlined"
                        density="compact"
                        hide-details
                        rows="3"
                      />
                      <div class="text-caption text-medium-emphasis mt-2">
                        <strong
                          >{{ t('chatbot_message_default_label') }}:
                        </strong>
                        <span
                          v-text="safeDefaultTransferMessageSectorText"
                        ></span>
                      </div>
                    </VCardText>
                  </VCard>

                  <VCard variant="outlined">
                    <VCardTitle
                      class="text-body-1 pa-3 pb-0 font-weight-bold d-flex align-center justify-space-between"
                    >
                      <span>{{
                        t('chatbot_message_transfer_sector_user')
                      }}</span>
                      <VSwitch
                        v-model="isTransferMessageSectorUserEnabled"
                        color="primary"
                        density="compact"
                        hide-details
                      />
                    </VCardTitle>
                    <VCardSubtitle
                      class="text-caption pa-3 pb-0 pt-0 config-description"
                    >
                      {{
                        t('chatbot_message_transfer_sector_user_description')
                      }}
                    </VCardSubtitle>
                    <VDivider />
                    <VCardText>
                      <VTextarea
                        v-model="transferMessageSectorUser"
                        v-bind:placeholder="
                          safeDefaultTransferMessageSectorUserText
                        "
                        :disabled="!isTransferMessageSectorUserEnabled"
                        variant="outlined"
                        density="compact"
                        hide-details
                        rows="3"
                      />
                      <div class="text-caption text-medium-emphasis mt-2">
                        <strong
                          >{{ t('chatbot_message_default_label') }}:
                        </strong>
                        <span
                          v-text="safeDefaultTransferMessageSectorUserText"
                        ></span>
                      </div>
                    </VCardText>
                  </VCard>
                </div>
              </template>
            </VWindowItem>
          </VWindow>
        </VCardText>

        <VDivider />

        <VCardText class="d-flex justify-end flex-wrap gap-3">
          <VBtn
            variant="tonal"
            color="secondary"
            :disabled="isSavingConfigurations"
            @click="closeConfigModal"
          >
            {{ t('cancel') }}
          </VBtn>
          <VBtn
            color="primary"
            :loading="isSavingConfigurations"
            :disabled="
              isSavingConfigurations || isInactivityAlertConfigurationIncomplete
            "
            @click="handleSaveConfigurations"
          >
            {{ t('save') }}
          </VBtn>
        </VCardText>
      </VCard>
    </VDialog>

    <Teleport to="body">
      <VCard
        v-if="isContextMenuOpen && contextMenuPosition && !isFlowReadOnly"
        ref="contextMenuCard"
        :style="{
          position: 'fixed',
          left: `${contextMenuPosition.x}px`,
          top: `${contextMenuPosition.y}px`,
          zIndex: 2000,
          pointerEvents: 'auto',
        }"
        min-width="180"
      >
        <VList density="compact">
          <VListItem @click="handleRemoveEdge" class="cursor-pointer">
            <template #prepend>
              <VIcon icon="tabler-trash" />
            </template>
            <VListItemTitle>{{ t('remove') }}</VListItemTitle>
          </VListItem>
        </VList>
      </VCard>
    </Teleport>

    <VSnackbar
      v-model="chatbotStore.snackbar.status"
      transition="scroll-y-reverse-transition"
      location="top end"
      :color="chatbotStore.snackbar.color"
    >
      {{ chatbotStore.snackbar.message }}
    </VSnackbar>
  </div>
</template>

<style scoped>
:deep(.vue-flow__node-default) {
  padding: 10px;
  background: white;
  border: 1px solid #1a192b;
  border-radius: 3px;
  min-width: 150px;
  text-align: center;
  font-size: 12px;
}

:deep(.vue-flow__handle) {
  box-sizing: border-box;
  width: 20px !important;
  height: 20px !important;
  min-width: 20px;
  min-height: 20px;
  border: 3px solid white !important;
  border-radius: 50%;
  background-color: #b1b1b7;
  box-shadow: 0 0 0 1px rgba(22, 43, 69, 0.17);
  z-index: 10;
}

:deep(.vue-flow__handle-top) {
  top: 0 !important;
}

:deep(.vue-flow__handle-bottom) {
  bottom: 0 !important;
}

:deep(.chatbot-workbench-node .vue-flow__handle-right) {
  right: -22px !important;
  transform: translateY(-50%) !important;
}

:deep(.vue-flow__handle.connectable) {
  cursor: crosshair;
}

:deep(.handle-target),
:deep(.vue-flow__handle.handle-target),
:deep(.vue-flow__handle-target) {
  background-color: #4caf50 !important;
}

:deep(.handle-source),
:deep(.vue-flow__handle.handle-source),
:deep(.vue-flow__handle-source) {
  background-color: #f44336 !important;
}

.chatbot-flow-workspace {
  container-type: inline-size;
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background:
    radial-gradient(
      circle at 5% 0%,
      rgba(var(--v-theme-primary), 0.1),
      transparent 31rem
    ),
    rgb(var(--v-theme-surface));
}

.workspace-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 24px;
  padding: 22px 24px;
}

.workspace-heading {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 14px;
}

.workspace-heading__icon {
  display: inline-grid;
  flex: 0 0 48px;
  place-items: center;
  border: 1px solid rgba(var(--v-theme-primary), 0.18);
  border-radius: 16px;
  background:
    linear-gradient(
      145deg,
      rgba(var(--v-theme-primary), 0.18),
      rgba(var(--v-theme-primary), 0.06)
    ),
    rgb(var(--v-theme-surface));
  block-size: 48px;
  color: rgb(var(--v-theme-primary));
  inline-size: 48px;
}

.workspace-heading__eyebrow {
  margin: 0 0 2px;
  color: rgb(var(--v-theme-primary));
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.09em;
  line-height: 1.2;
  text-transform: uppercase;
}

.workspace-heading__title {
  margin: 0;
  color: rgb(var(--v-theme-on-surface));
  font-size: clamp(1.15rem, 1.7vw, 1.45rem);
  font-weight: 800;
  letter-spacing: -0.025em;
  line-height: 1.2;
}

.workspace-heading__subtitle {
  margin: 5px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.86rem;
  line-height: 1.45;
}

.workspace-actions {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  max-inline-size: 100%;
  min-inline-size: 0;
}

.workspace-body {
  padding: 16px !important;
}

.flow-layout {
  block-size: clamp(640px, calc(100dvh - 250px), 840px);
  min-block-size: 640px;
}

.flow-area {
  position: relative;
  block-size: 100%;
  min-block-size: 0;
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 18px;
  background:
    radial-gradient(
        circle,
        rgba(var(--v-theme-primary), 0.16) 1px,
        transparent 1.2px
      )
      0 0 / 22px 22px,
    linear-gradient(
      180deg,
      rgba(var(--v-theme-primary), 0.035),
      transparent 24%
    ),
    rgb(var(--v-theme-surface));
  box-shadow:
    inset 0 1px 0 rgba(var(--v-theme-on-surface), 0.03),
    0 18px 48px rgba(var(--v-theme-on-surface), 0.05);
}

.flow-area :deep(.vue-flow) {
  block-size: 100%;
  inline-size: 100%;
}

.flow-canvas-surface {
  block-size: 100%;
  inline-size: 100%;
}

.flow-area :deep(.vue-flow__pane) {
  background: transparent;
}

.flow-area--read-only :deep(.vue-flow__node) {
  pointer-events: none;
}

.flow-read-only-notice {
  position: absolute;
  z-index: 5;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  max-inline-size: min(440px, calc(100% - 32px));
  padding: 8px 11px;
  border: 1px solid rgba(var(--v-theme-warning), 0.24);
  border-radius: 10px;
  background: rgba(var(--v-theme-surface), 0.94);
  box-shadow: 0 8px 24px rgba(var(--v-theme-on-surface), 0.1);
  color: rgba(var(--v-theme-on-surface), 0.72);
  font-size: 0.6875rem;
  font-weight: 650;
  inset-block-start: 14px;
  inset-inline-end: 14px;
  pointer-events: none;
}

.flow-read-only-notice :deep(.v-icon) {
  flex: 0 0 auto;
  color: rgb(var(--v-theme-warning));
}

.flow-toolbar {
  position: absolute;
  z-index: 4;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 12px;
  background: rgb(var(--v-theme-surface));
  box-shadow: 0 10px 28px rgba(var(--v-theme-on-surface), 0.12);
  inset-block-end: 14px;
  inset-inline-start: 14px;
}

.flow-toolbar :deep(.v-btn) {
  border-radius: 0;
  border-color: rgba(var(--v-theme-on-surface), 0.08);
  color: rgb(var(--v-theme-on-surface));
}

.flow-toolbar :deep(.v-btn:hover) {
  background: rgba(var(--v-theme-primary), 0.1);
  color: rgb(var(--v-theme-primary));
}

.flow-toolbar :deep(.v-btn + .v-btn) {
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}

@container (max-width: 1180px) {
  .workspace-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .workspace-actions {
    inline-size: 100%;
    justify-content: flex-start;
  }
}

@media (max-width: 959px) {
  .workspace-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .workspace-actions {
    justify-content: flex-start;
  }

  .flow-layout {
    block-size: clamp(600px, calc(100dvh - 290px), 760px);
    min-block-size: 600px;
  }
}

@media (max-width: 719px) {
  .workspace-header {
    gap: 16px;
    padding: 18px;
  }

  .workspace-heading__subtitle {
    display: none;
  }

  .workspace-actions {
    inline-size: 100%;
  }

  .workspace-actions :deep(.v-btn) {
    flex: 1 1 auto;
  }

  .workspace-body {
    padding: 10px !important;
  }

  .flow-layout {
    block-size: calc(100dvh - 230px);
    min-block-size: 540px;
  }

  .flow-area {
    border-radius: 14px;
  }

  .flow-toolbar {
    inset-block-end: 10px;
    inset-inline-start: 10px;
  }
}

.config-description {
  white-space: normal;
  word-wrap: break-word;
  overflow-wrap: break-word;
  text-overflow: unset;
}

.max-height-300 {
  max-height: 300px;
  overflow-y: auto;
}

.cursor-pointer {
  cursor: pointer;
}

:deep(.vue-flow__edge.selected) {
  stroke: #1976d2 !important;
  stroke-width: 3 !important;
}

:deep(.vue-flow__edge.selected .vue-flow__edge-path) {
  stroke: #1976d2 !important;
  stroke-width: 3 !important;
}

:deep(.vue-flow__edge.selected .vue-flow__edge-marker) {
  fill: #1976d2 !important;
}
</style>
