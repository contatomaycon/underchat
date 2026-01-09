<script setup lang="ts">
import {
  ref,
  markRaw,
  computed,
  onMounted,
  onUnmounted,
  watch,
  nextTick,
} from 'vue';
import { VueFlow } from '@vue-flow/core';
import type { Node, Edge, Connection, NodeChange } from '@vue-flow/core';
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
import ChatbotContactNode from '@/components/chatbot/ChatbotContactNode.vue';
import ChatbotAiAgentNode from '@/components/chatbot/ChatbotAiAgentNode.vue';
import ChatbotAnnotationNode from '@/components/chatbot/ChatbotAnnotationNode.vue';
import { useI18n } from 'vue-i18n';
import { useRouter, useRoute } from 'vue-router';
import DialogCloseBtn from '@/@webcore/components/DialogCloseBtn.vue';
import { useChatbotStore } from '@/@webcore/stores/chatbot';
import { useAiAgentStore } from '@/@webcore/stores/aiAgent';
import { getUser } from '@/@webcore/localStorage/user';

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
  contact: markRaw(ChatbotContactNode),
  aiAgent: markRaw(ChatbotAiAgentNode),
  annotation: markRaw(ChatbotAnnotationNode),
};

const { t } = useI18n();
const router = useRouter();
const route = useRoute();
const chatbotStore = useChatbotStore();

const aiAgentStore = useAiAgentStore();

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

const isConfigModalOpen = ref(false);
const inactivityAlertStatus = ref<'active' | 'inactive'>('inactive');
const inactivityAlertQuantity = ref('');
const inactivityAlertTime = ref('');
const inactivityAlertAction = ref<'redirect' | 'finish' | null>(null);
const inactivityAlertRedirectType = ref<'user' | 'sector' | null>(null);
const inactivityAlertSelectedUser = ref<string | null>(null);
const inactivityAlertSelectedSector = ref<string | null>(null);
const inactivityAlertSelectedSectorUser = ref<string | null>(null);

const redirectFailedAttemptsStatus = ref<'active' | 'inactive'>('inactive');
const redirectFailedAttemptsQuantity = ref('');
const redirectFailedAttemptsRedirectType = ref<'user' | 'sector' | null>(null);
const redirectFailedAttemptsSelectedUser = ref<string | null>(null);
const redirectFailedAttemptsSelectedSector = ref<string | null>(null);
const redirectFailedAttemptsSelectedSectorUser = ref<string | null>(null);

const finishTriggers = ref<string[]>([]);
const finishTriggerInput = ref('');

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
const defaultTransferMessageUser = computed(() =>
  t('chatbot_transfer_message_user_default')
);
const defaultTransferMessageSector = computed(() =>
  t('chatbot_transfer_message_sector_default')
);
const defaultTransferMessageSectorUser = computed(() =>
  t('chatbot_transfer_message_sector_user_default')
);

const availableVariables = computed(() => [
  {
    tag: '{{ sector }}',
    description: t('chatbot_variable_sector_description'),
  },
  {
    tag: '{{ user }}',
    description: t('chatbot_variable_user_description'),
  },
  {
    tag: '{{ greeting }}',
    description: t('chatbot_variable_greeting_description'),
  },
  {
    tag: '{{ name }}',
    description: t('chatbot_variable_name_description'),
  },
  {
    tag: '{{ protocol }}',
    description: t('chatbot_variable_protocol_description'),
  },
  {
    tag: '{{ date }}',
    description: t('chatbot_variable_date_description'),
  },
  {
    tag: '{{ time }}',
    description: t('chatbot_variable_time_description'),
  },
  {
    tag: '{{ account_name }}',
    description: t('chatbot_variable_account_name_description'),
  },
  {
    tag: '{{ phone }}',
    description: t('chatbot_variable_phone_description'),
  },
  {
    tag: '{{ channel_name }}',
    description: t('chatbot_variable_channel_name_description'),
  },
]);

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

const onlyDigits = (s: string) => s.replaceAll(/\D+/g, '');

const inactivityAlertQuantityComputed = computed({
  get: () => inactivityAlertQuantity.value,
  set: (value: string) => {
    inactivityAlertQuantity.value = onlyDigits(value);
  },
});

const inactivityAlertTimeComputed = computed({
  get: () => inactivityAlertTime.value,
  set: (value: string) => {
    inactivityAlertTime.value = onlyDigits(value);
  },
});

const redirectFailedAttemptsQuantityComputed = computed({
  get: () => redirectFailedAttemptsQuantity.value,
  set: (value: string) => {
    redirectFailedAttemptsQuantity.value = onlyDigits(value);
  },
});

const showInactivityAlertFields = computed(
  () => inactivityAlertStatus.value === 'active'
);

const showInactivityAlertActionFields = computed(
  () => showInactivityAlertFields.value && inactivityAlertAction.value !== null
);

const showInactivityAlertRedirectFields = computed(
  () =>
    showInactivityAlertActionFields.value &&
    inactivityAlertAction.value === 'redirect'
);

const showInactivityAlertUserField = computed(
  () =>
    showInactivityAlertRedirectFields.value &&
    inactivityAlertRedirectType.value === 'user'
);

const showInactivityAlertSectorField = computed(
  () =>
    showInactivityAlertRedirectFields.value &&
    inactivityAlertRedirectType.value === 'sector'
);

const showInactivityAlertSectorUserField = computed(
  () =>
    showInactivityAlertSectorField.value &&
    inactivityAlertSelectedSector.value !== null
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
  isConfigModalOpen.value = true;
  await loadChatbotFlowConfigurations();
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

const selectedEdgeId = ref<string | null>(null);
const contextMenuPosition = ref<{ x: number; y: number } | null>(null);
const isContextMenuOpen = ref(false);
const contextMenuEdgeId = ref<string | null>(null);
const contextMenuCard = ref<HTMLElement | null>(null);

let nodeIdCounter = 2;
const optionNodeTypes = new Set(['menu', 'satisfaction', 'contact']);

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
    | Node
    | undefined;
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
    | Node
    | undefined;
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
  const nodeIndex = nodes.value.findIndex((n) => n.id === nodeId);
  if (nodeIndex > -1) {
    nodes.value.splice(nodeIndex, 1);
  }

  edges.value = edges.value.filter(
    (e) => e.source !== nodeId && e.target !== nodeId
  );
};

const removeEdge = (edgeId: string) => {
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
  if (event.key === 'Delete' || event.key === 'Backspace') {
    if (selectedEdgeId.value) {
      removeEdge(selectedEdgeId.value);
      event.preventDefault();
    }
  }
};

const removeOptionEdge = (nodeId: string, optionId: string) => {
  const sourceHandle = `option-${optionId}-source`;
  edges.value = edges.value.filter(
    (e) => !(e.source === nodeId && e.sourceHandle === sourceHandle)
  );
};

const removeInteractionsEdge = (nodeId: string) => {
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

const removeHumanSupportEdge = (nodeId: string) => {
  const sourceHandle = 'human-support-source';
  const normalizedHandle = 'human-support';
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
  nodes.value.push(newNode as Node);
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
  nodes.value.push(newNode as Node);
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
  nodes.value.push(newNode as Node);
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
      selectedUser: null,
      selectedSector: null,
      selectedSectorUser: null,
      onRemove: () => removeNode(nodeId),
    },
  };
  nodes.value.push(newNode as Node);
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
  nodes.value.push(newNode as Node);
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
      selectedTag: null,
      onRemove: () => removeNode(nodeId),
    },
  };
  nodes.value.push(newNode as Node);
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
  nodes.value.push(newNode as Node);
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
      messageType: null,
      text: '',
      attachmentFile: null,
      attachmentUrl: null,
      attachmentMimetype: null,
      attachmentDuration: null,
      attachmentWidth: null,
      attachmentHeight: null,
      continueType: null,
      onRemove: () => removeNode(nodeId),
    },
  };
  nodes.value.push(newNode as Node);
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
      dataType: null,
      firstName: t('chatbot_data_default_name_question'),
      email: t('chatbot_data_default_email_question'),
      cpf: t('chatbot_data_default_cpf_question'),
      cnpj: t('chatbot_data_default_cnpj_question'),
      onRemove: () => removeNode(nodeId),
    },
  };
  nodes.value.push(newNode as Node);
};

const addAiAgentNode = (position?: { x: number; y: number }) => {
  const nodeId = `aiAgent-${nodeIdCounter++}`;
  const positiveOptionId = crypto.randomUUID();
  const negativeOptionId = crypto.randomUUID();
  const newNode: Node = {
    id: nodeId,
    type: 'aiAgent',
    position: position || {
      x: getSecureRandom(400) + 100,
      y: getSecureRandom(300) + 100,
    },
    data: {
      selectedAiAgent: null,
      defaultQuestion: null,
      continueMessage: null,
      actionAfterInteractions: true,
      interactionsQuantity: 5,
      options: [
        {
          id: positiveOptionId,
          text: t('chatbot_ai_agent_positive_option'),
          required: true,
        },
        {
          id: negativeOptionId,
          text: t('chatbot_ai_agent_negative_option'),
          required: true,
        },
      ],
      onRemove: () => removeNode(nodeId),
      onRemoveOption: (optionId: string) => removeOptionEdge(nodeId, optionId),
      onRemoveInteractionsEdge: () => removeInteractionsEdge(nodeId),
      onRemoveHumanSupportEdge: () => removeHumanSupportEdge(nodeId),
    },
  };
  nodes.value.push(newNode as Node);
};

const onConnect = (connection: Connection) => {
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

const onDrop = (event: DragEvent) => {
  if (!draggedNodeType.value) return;

  event.preventDefault();
  event.stopPropagation();

  const vueFlowElement = document.querySelector('.vue-flow') as HTMLElement;
  if (!vueFlowElement) return;

  const rect = vueFlowElement.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;

  const viewport = vueFlowRef.value?.viewport || { x: 0, y: 0, zoom: 1 };
  const position = {
    x: (x - viewport.x) / viewport.zoom,
    y: (y - viewport.y) / viewport.zoom,
  };

  switch (draggedNodeType.value) {
    case 'menu':
      addMenuNode(position);
      break;
    case 'satisfaction':
      addSatisfactionNode(position);
      break;
    case 'redirect':
      addRedirectNode(position);
      break;
    case 'finish':
      addFinishNode(position);
      break;
    case 'tag':
      addTagNode(position);
      break;
    case 'message':
      addMessageNode(position);
      break;
    case 'data':
      addDataNode(position);
      break;
    case 'contact':
      addContactMenuNode(position);
      break;
    case 'aiAgent':
      addAiAgentNode(position);
      break;
    case 'annotation':
      addAnnotationNode(position);
      break;
  }

  draggedNodeType.value = null;
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
    const nodeData: Record<string, any> = { ...node.data };
    if (nodeData && 'attachmentFile' in nodeData) {
      delete nodeData.attachmentFile;
    }
    if (nodeData && 'onRemove' in nodeData) {
      delete nodeData.onRemove;
    }
    if (nodeData && 'onRemoveOption' in nodeData) {
      delete nodeData.onRemoveOption;
    }
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
      if (
        !nodeData.defaultQuestion ||
        (typeof nodeData.defaultQuestion === 'string' &&
          nodeData.defaultQuestion.trim().length === 0)
      ) {
        nodeData.defaultQuestion = null;
      }
      if (
        !nodeData.continueMessage ||
        (typeof nodeData.continueMessage === 'string' &&
          nodeData.continueMessage.trim().length === 0)
      ) {
        nodeData.continueMessage = null;
      }
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

const handleSave = async () => {
  if (!chatbotId.value) {
    chatbotStore.showSnackbar(
      t('chatbot_flow_validation_chatbot_id_required'),
      EColor.error
    );
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

      if (!attachmentFile) {
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
  if (nodeData.selectedUser === undefined) nodeData.selectedUser = null;
  if (nodeData.selectedSector === undefined) nodeData.selectedSector = null;
  if (nodeData.selectedSectorUser === undefined)
    nodeData.selectedSectorUser = null;
};

const processTagNodeData = (nodeData: any): void => {
  if (nodeData.tagType === undefined) nodeData.tagType = null;
  if (nodeData.selectedTag === undefined) nodeData.selectedTag = null;
};

const processAnnotationNodeData = (nodeData: any): void => {
  if (nodeData.annotation === undefined) nodeData.annotation = '';
};

const processAiAgentNodeData = (nodeData: any): void => {
  if (nodeData.selectedAiAgent === undefined) nodeData.selectedAiAgent = null;
  if (nodeData.defaultQuestion === undefined) nodeData.defaultQuestion = null;
  if (nodeData.continueMessage === undefined) nodeData.continueMessage = null;
  if (nodeData.actionAfterInteractions === undefined)
    nodeData.actionAfterInteractions = true;
  if (nodeData.interactionsQuantity === undefined)
    nodeData.interactionsQuantity = 5;
  if (!nodeData.options || nodeData.options.length === 0) {
    const positiveOptionId = crypto.randomUUID();
    const negativeOptionId = crypto.randomUUID();
    nodeData.options = [
      {
        id: positiveOptionId,
        text: t('chatbot_ai_agent_positive_option'),
        required: true,
      },
      {
        id: negativeOptionId,
        text: t('chatbot_ai_agent_negative_option'),
        required: true,
      },
    ];
  }
};

const processMessageNodeData = (nodeData: any): void => {
  if (nodeData.messageType === undefined) nodeData.messageType = null;
  if (nodeData.text === undefined) nodeData.text = '';
  if (nodeData.attachmentFile === undefined) nodeData.attachmentFile = null;
  if (nodeData.attachmentUrl === undefined) nodeData.attachmentUrl = null;
  if (nodeData.attachmentMimetype === undefined)
    nodeData.attachmentMimetype = null;
  if (nodeData.attachmentDuration === undefined)
    nodeData.attachmentDuration = null;
  if (nodeData.attachmentWidth === undefined) nodeData.attachmentWidth = null;
  if (nodeData.attachmentHeight === undefined) nodeData.attachmentHeight = null;
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

const processNodeDataByType = (node: Node): void => {
  if (!node.data) {
    node.data = {};
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
    case 'data':
      processDataNodeData(node.data);
      break;
    case 'aiAgent':
      processAiAgentNodeData(node.data);
      break;
    case 'annotation':
      processAnnotationNodeData(node.data);
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
    node.draggable = true;
    if (!node.data) {
      node.data = {};
    }
    node.data.onRemove = () => removeNode(node.id);

    if (
      node.type === 'menu' ||
      node.type === 'satisfaction' ||
      node.type === 'contact' ||
      node.type === 'aiAgent'
    ) {
      node.data.onRemoveOption = (optionId: string) =>
        removeOptionEdge(node.id, optionId);
    }

    if (node.type === 'aiAgent') {
      node.data.onRemoveInteractionsEdge = () =>
        removeInteractionsEdge(node.id);
      node.data.onRemoveHumanSupportEdge = () =>
        removeHumanSupportEdge(node.id);
    }
  }

  processNodeDataByType(node);
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

  isLoadingFlow.value = true;

  try {
    const flow = await chatbotStore.listChatbotFlow(chatbotId.value);

    if (!flow) {
      return;
    }

    if (flow.nodes && flow.nodes.length > 0) {
      processLoadedNodes(flow.nodes as Node[]);
    } else {
      nodes.value = initialNodes;
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
    inactivityAlertRedirectType.value = config.redirect_type as
      | 'user'
      | 'sector';
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
      | 'user'
      | 'sector';
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
  if (!chatbotId.value) {
    chatbotStore.showSnackbar(
      t('chatbot_flow_validation_chatbot_id_required'),
      EColor.error
    );
    return;
  }

  try {
    const configurations = {
      inactivity_alert:
        inactivityAlertStatus.value === 'active'
          ? {
              status: inactivityAlertStatus.value,
              quantity: inactivityAlertQuantity.value
                ? Number.parseInt(inactivityAlertQuantity.value)
                : undefined,
              time: inactivityAlertTime.value
                ? Number.parseInt(inactivityAlertTime.value)
                : undefined,
              action: inactivityAlertAction.value || undefined,
              redirect_type: inactivityAlertRedirectType.value || undefined,
              selected_user: inactivityAlertSelectedUser.value || undefined,
              selected_sector: inactivityAlertSelectedSector.value || undefined,
              selected_sector_user:
                inactivityAlertSelectedSectorUser.value || undefined,
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
  loadChatbotFlow();
  window.addEventListener('keydown', handleDeleteKey);
  document.addEventListener('click', handleDocumentClick, true);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleDeleteKey);
  document.removeEventListener('click', handleDocumentClick, true);
});
</script>

<template>
  <div>
    <VCard :title="`${t('configurations')} ${t('chatbot')}`">
      <VCardText>
        <div class="actions-row">
          <VBtn
            variant="tonal"
            color="info"
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
            :disabled="!chatbotId"
            @click="handleSave"
          >
            {{ t('save') }}
          </VBtn>
        </div>
        <div class="flow-layout">
          <div class="node-menu">
            <VBtn color="secondary" @click="openConfigModal">
              <VIcon icon="tabler-settings" class="me-2" />
              {{ t('chatbot_configurations') }}
            </VBtn>
            <VBtn
              color="primary"
              draggable="true"
              @dragstart.stop="
                (e: DragEvent) => {
                  draggedNodeType = 'menu';
                  e.dataTransfer!.effectAllowed = 'move';
                  e.dataTransfer!.dropEffect = 'move';
                }
              "
              @dragend="
                () => {
                  draggedNodeType = null;
                }
              "
              style="cursor: grab"
            >
              <VIcon icon="tabler-menu-2" class="me-2" />
              {{ t('chatbot_menu') }}
            </VBtn>
            <VBtn
              color="warning"
              draggable="true"
              @dragstart.stop="
                (e: DragEvent) => {
                  draggedNodeType = 'satisfaction';
                  e.dataTransfer!.effectAllowed = 'move';
                  e.dataTransfer!.dropEffect = 'move';
                }
              "
              @dragend="
                () => {
                  draggedNodeType = null;
                }
              "
              style="cursor: grab"
            >
              <VIcon icon="tabler-star" class="me-2" />
              {{ t('chatbot_satisfaction') }}
            </VBtn>
            <VDivider class="my-2" />
            <div class="text-caption text-medium-emphasis mb-2">
              {{ t('chatbot_options') }}
            </div>
            <VBtn
              color="info"
              draggable="true"
              @dragstart.stop="
                (e: DragEvent) => {
                  draggedNodeType = 'redirect';
                  e.dataTransfer!.effectAllowed = 'move';
                  e.dataTransfer!.dropEffect = 'move';
                }
              "
              @dragend="
                () => {
                  draggedNodeType = null;
                }
              "
              style="cursor: grab"
            >
              <VIcon icon="tabler-arrow-forward" class="me-2" />
              {{ t('chatbot_redirect') }}
            </VBtn>
            <VBtn
              color="error"
              draggable="true"
              @dragstart.stop="
                (e: DragEvent) => {
                  draggedNodeType = 'finish';
                  e.dataTransfer!.effectAllowed = 'move';
                  e.dataTransfer!.dropEffect = 'move';
                }
              "
              @dragend="
                () => {
                  draggedNodeType = null;
                }
              "
              style="cursor: grab"
            >
              <VIcon icon="tabler-circle-check" class="me-2" />
              {{ t('chatbot_finish') }}
            </VBtn>
            <VBtn
              color="secondary"
              draggable="true"
              @dragstart.stop="
                (e: DragEvent) => {
                  draggedNodeType = 'tag';
                  e.dataTransfer!.effectAllowed = 'move';
                  e.dataTransfer!.dropEffect = 'move';
                }
              "
              @dragend="
                () => {
                  draggedNodeType = null;
                }
              "
              style="cursor: grab"
            >
              <VIcon icon="tabler-tag" class="me-2" />
              {{ t('chatbot_tag_node_title') }}
            </VBtn>
            <VBtn
              color="success"
              draggable="true"
              @dragstart.stop="
                (e: DragEvent) => {
                  draggedNodeType = 'message';
                  e.dataTransfer!.effectAllowed = 'move';
                  e.dataTransfer!.dropEffect = 'move';
                }
              "
              @dragend="
                () => {
                  draggedNodeType = null;
                }
              "
              style="cursor: grab"
            >
              <VIcon icon="tabler-message" class="me-2" />
              {{ t('chatbot_message') }}
            </VBtn>
            <VBtn
              color="info"
              draggable="true"
              @dragstart.stop="
                (e: DragEvent) => {
                  draggedNodeType = 'data';
                  e.dataTransfer!.effectAllowed = 'move';
                  e.dataTransfer!.dropEffect = 'move';
                }
              "
              @dragend="
                () => {
                  draggedNodeType = null;
                }
              "
              style="cursor: grab"
            >
              <VIcon icon="tabler-database" class="me-2" />
              {{ t('chatbot_data') }}
            </VBtn>
            <VBtn
              color="tertiary"
              draggable="true"
              @dragstart.stop="
                (e: DragEvent) => {
                  draggedNodeType = 'contact';
                  e.dataTransfer!.effectAllowed = 'move';
                  e.dataTransfer!.dropEffect = 'move';
                }
              "
              @dragend="
                () => {
                  draggedNodeType = null;
                }
              "
              style="cursor: grab"
            >
              <VIcon icon="tabler-users" class="me-2" />
              {{ t('chatbot_contact') }}
            </VBtn>
            <VBtn
              v-if="canUseAiAgentPermission && canUseAiAgent"
              color="primary"
              draggable="true"
              @dragstart.stop="
                (e: DragEvent) => {
                  draggedNodeType = 'aiAgent';
                  e.dataTransfer!.effectAllowed = 'move';
                  e.dataTransfer!.dropEffect = 'move';
                }
              "
              @dragend="
                () => {
                  draggedNodeType = null;
                }
              "
              style="cursor: grab"
            >
              <VIcon icon="tabler-brain" class="me-2" />
              {{ t('chatbot_ai_agent') }}
            </VBtn>
            <VBtn
              color="annotation"
              draggable="true"
              @dragstart.stop="
                (e: DragEvent) => {
                  draggedNodeType = 'annotation';
                  e.dataTransfer!.effectAllowed = 'move';
                  e.dataTransfer!.dropEffect = 'move';
                }
              "
              @dragend="
                () => {
                  draggedNodeType = null;
                }
              "
              style="cursor: grab"
            >
              <VIcon icon="tabler-note" class="me-2" />
              {{ t('chatbot_annotation_node_title') }}
            </VBtn>
          </div>
          <div class="vertical-divider" />
          <div class="flow-area">
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
                markerEnd: { type: 'arrowclosed', color: '#1a192b' } as any,
                style: { stroke: '#1a192b', strokeWidth: 2 },
              }"
              :connection-radius="20"
              @connect="onConnect"
              @nodes-change="onNodesChange"
              @drop="onDrop"
              @dragover.prevent
              @edge-click="onEdgeClick"
              @edge-context-menu="onEdgeContextMenu"
              @pane-click="onPaneClick"
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
              <VCard variant="outlined" class="mb-4">
                <VCardTitle class="text-body-1 pa-3 pb-0 font-weight-bold">
                  {{ t('chatbot_inactivity_alert') }}
                </VCardTitle>
                <VCardSubtitle
                  class="text-caption pa-3 pb-0 pt-0 config-description"
                >
                  {{ t('chatbot_inactivity_alert_description') }}
                </VCardSubtitle>
                <VDivider />
                <VCardText>
                  <div class="mb-3">
                    <VLabel class="mb-1 text-body-2">{{
                      t('chatbot_inactivity_alert')
                    }}</VLabel>
                    <AppSelectSearch
                      v-model="inactivityAlertStatus"
                      :items="[
                        {
                          id: 'active',
                          title: t('chatbot_inactivity_alert_active'),
                        },
                        {
                          id: 'inactive',
                          title: t('chatbot_inactivity_alert_inactive'),
                        },
                      ]"
                      item-value="id"
                      item-title="title"
                      :clearable="false"
                    />
                  </div>

                  <div v-if="showInactivityAlertFields">
                    <div class="mb-3">
                      <VLabel class="mb-1 text-body-2">{{
                        t('chatbot_inactivity_alert_quantity')
                      }}</VLabel>
                      <VTextField
                        v-model="inactivityAlertQuantityComputed"
                        @keydown="onKeyPress"
                        @paste.prevent="
                          (e: ClipboardEvent) => {
                            const pastedText =
                              e.clipboardData?.getData('text') || '';
                            const numericValue = onlyDigits(pastedText);
                            if (numericValue) {
                              inactivityAlertQuantityComputed = numericValue;
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
                        t('chatbot_inactivity_alert_time')
                      }}</VLabel>
                      <VTextField
                        v-model="inactivityAlertTimeComputed"
                        @keydown="onKeyPress"
                        @paste.prevent="
                          (e: ClipboardEvent) => {
                            const pastedText =
                              e.clipboardData?.getData('text') || '';
                            const numericValue = onlyDigits(pastedText);
                            if (numericValue) {
                              inactivityAlertTimeComputed = numericValue;
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
                        t('chatbot_action')
                      }}</VLabel>
                      <AppSelectSearch
                        v-model="inactivityAlertAction"
                        :items="[
                          { id: 'redirect', title: t('chatbot_redirect') },
                          { id: 'finish', title: t('chatbot_finish') },
                        ]"
                        item-value="id"
                        item-title="title"
                        :clearable="false"
                      />
                    </div>

                    <div v-if="showInactivityAlertRedirectFields">
                      <div class="mb-3">
                        <VLabel class="mb-1 text-body-2">{{
                          t('chatbot_redirect_to')
                        }}</VLabel>
                        <AppSelectSearch
                          v-model="inactivityAlertRedirectType"
                          :items="[
                            {
                              id: 'user',
                              title: t('chatbot_redirect_user'),
                            },
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

                      <div v-if="showInactivityAlertUserField" class="mb-3">
                        <AppSelectSearch
                          v-model="inactivityAlertSelectedUser"
                          :items="inactivityUsers"
                          :label="t('chatbot_user_label')"
                          :placeholder="t('chatbot_search')"
                          :loading="isLoadingInactivityUsers"
                          :clearable="true"
                          item-value="value"
                          item-title="title"
                          @select="loadInactivityUsers()"
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

                      <div v-if="showInactivityAlertSectorField" class="mb-3">
                        <AppSelectSearch
                          v-model="inactivityAlertSelectedSector"
                          :items="inactivitySectors"
                          :label="t('chatbot_sector_label')"
                          :placeholder="t('chatbot_search')"
                          :loading="isLoadingInactivitySectors"
                          :clearable="true"
                          item-value="value"
                          item-title="title"
                          @select="loadInactivitySectors()"
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
                        v-if="showInactivityAlertSectorUserField"
                        class="mb-3"
                      >
                        <AppSelectSearch
                          v-model="inactivityAlertSelectedSectorUser"
                          :items="inactivitySectorUsers"
                          :label="t('chatbot_sector_user_label')"
                          :placeholder="t('chatbot_search_optional')"
                          :loading="isLoadingInactivitySectorUsers"
                          :clearable="true"
                          item-value="value"
                          item-title="title"
                          @select="
                            inactivityAlertSelectedSector
                              ? loadInactivitySectorUsers(
                                  inactivityAlertSelectedSector
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
                  </div>
                </VCardText>
              </VCard>

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
                          title: t('chatbot_redirect_failed_attempts_inactive'),
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
            </VWindowItem>

            <VWindowItem value="messages">
              <div class="d-flex flex-column gap-4">
                <VCard variant="outlined">
                  <VCardTitle class="text-body-1 pa-3 pb-0 font-weight-bold">
                    {{ t('chatbot_message_inactivity') }}
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
                      variant="outlined"
                      density="compact"
                      hide-details
                      rows="3"
                    />
                    <div class="text-caption text-medium-emphasis mt-2">
                      <strong>{{ t('chatbot_message_default_label') }}:</strong>
                      {{ defaultInactivityMessage }}
                    </div>
                  </VCardText>
                </VCard>

                <VCard variant="outlined">
                  <VCardTitle class="text-body-1 pa-3 pb-0 font-weight-bold">
                    {{ t('chatbot_message_invalid_menu_option') }}
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
                      variant="outlined"
                      density="compact"
                      hide-details
                      rows="3"
                    />
                    <div class="text-caption text-medium-emphasis mt-2">
                      <strong>{{ t('chatbot_message_default_label') }}:</strong>
                      {{ defaultInvalidMenuOptionMessage }}
                    </div>
                  </VCardText>
                </VCard>

                <VCard variant="outlined">
                  <VCardTitle class="text-body-1 pa-3 pb-0 font-weight-bold">
                    {{ t('chatbot_message_invalid_satisfaction_option') }}
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
                      variant="outlined"
                      density="compact"
                      hide-details
                      rows="3"
                    />
                    <div class="text-caption text-medium-emphasis mt-2">
                      <strong>{{ t('chatbot_message_default_label') }}:</strong>
                      {{ defaultInvalidSatisfactionOptionMessage }}
                    </div>
                  </VCardText>
                </VCard>

                <VCard variant="outlined">
                  <VCardTitle class="text-body-1 pa-3 pb-0 font-weight-bold">
                    {{ t('chatbot_message_invalid_cpf') }}
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
                      variant="outlined"
                      density="compact"
                      hide-details
                      rows="3"
                    />
                    <div class="text-caption text-medium-emphasis mt-2">
                      <strong>{{ t('chatbot_message_default_label') }}:</strong>
                      {{ defaultInvalidCpfMessage }}
                    </div>
                  </VCardText>
                </VCard>

                <VCard variant="outlined">
                  <VCardTitle class="text-body-1 pa-3 pb-0 font-weight-bold">
                    {{ t('chatbot_message_invalid_cnpj') }}
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
                      variant="outlined"
                      density="compact"
                      hide-details
                      rows="3"
                    />
                    <div class="text-caption text-medium-emphasis mt-2">
                      <strong>{{ t('chatbot_message_default_label') }}:</strong>
                      {{ defaultInvalidCnpjMessage }}
                    </div>
                  </VCardText>
                </VCard>

                <VCard variant="outlined">
                  <VCardTitle class="text-body-1 pa-3 pb-0 font-weight-bold">
                    {{ t('chatbot_message_invalid_email') }}
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
                      variant="outlined"
                      density="compact"
                      hide-details
                      rows="3"
                    />
                    <div class="text-caption text-medium-emphasis mt-2">
                      <strong>{{ t('chatbot_message_default_label') }}:</strong>
                      {{ defaultInvalidEmailMessage }}
                    </div>
                  </VCardText>
                </VCard>

                <VCard variant="outlined">
                  <VCardTitle class="text-body-1 pa-3 pb-0 font-weight-bold">
                    {{ t('chatbot_message_service_finished') }}
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
                      variant="outlined"
                      density="compact"
                      hide-details
                      rows="3"
                    />
                    <div class="text-caption text-medium-emphasis mt-2">
                      <strong>{{ t('chatbot_message_default_label') }}:</strong>
                      {{ defaultServiceFinishedMessage }}
                    </div>
                  </VCardText>
                </VCard>

                <VCard variant="outlined">
                  <VCardTitle class="text-body-1 pa-3 pb-0 font-weight-bold">
                    {{ t('chatbot_message_transfer_user') }}
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
                      :placeholder="
                        defaultTransferMessageUser ||
                        t('chatbot_transfer_message_user_default')
                      "
                      variant="outlined"
                      density="compact"
                      hide-details
                      rows="3"
                    />
                    <div class="text-caption text-medium-emphasis mt-2">
                      <strong>{{ t('chatbot_message_default_label') }}:</strong>
                      {{ defaultTransferMessageUser ||
                      t('chatbot_transfer_message_user_default') }}
                    </div>
                  </VCardText>
                </VCard>

                <VCard variant="outlined">
                  <VCardTitle class="text-body-1 pa-3 pb-0 font-weight-bold">
                    {{ t('chatbot_message_transfer_sector') }}
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
                      :placeholder="
                        defaultTransferMessageSector ||
                        t('chatbot_transfer_message_sector_default')
                      "
                      variant="outlined"
                      density="compact"
                      hide-details
                      rows="3"
                    />
                    <div class="text-caption text-medium-emphasis mt-2">
                      <strong>{{ t('chatbot_message_default_label') }}:</strong>
                      {{ defaultTransferMessageSector ||
                      t('chatbot_transfer_message_sector_default') }}
                    </div>
                  </VCardText>
                </VCard>

                <VCard variant="outlined">
                  <VCardTitle class="text-body-1 pa-3 pb-0 font-weight-bold">
                    {{ t('chatbot_message_transfer_sector_user') }}
                  </VCardTitle>
                  <VCardSubtitle
                    class="text-caption pa-3 pb-0 pt-0 config-description"
                  >
                    {{ t('chatbot_message_transfer_sector_user_description') }}
                  </VCardSubtitle>
                  <VDivider />
                  <VCardText>
                    <VTextarea
                      v-model="transferMessageSectorUser"
                      :placeholder="
                        defaultTransferMessageSectorUser ||
                        t('chatbot_transfer_message_sector_user_default')
                      "
                      variant="outlined"
                      density="compact"
                      hide-details
                      rows="3"
                    />
                    <div class="text-caption text-medium-emphasis mt-2">
                      <strong>{{ t('chatbot_message_default_label') }}:</strong>
                      {{ defaultTransferMessageSectorUser ||
                      t('chatbot_transfer_message_sector_user_default') }}
                    </div>
                  </VCardText>
                </VCard>
              </div>
            </VWindowItem>
          </VWindow>
        </VCardText>

        <VDivider />

        <VCardText class="d-flex justify-end flex-wrap gap-3">
          <VBtn variant="tonal" color="secondary" @click="closeConfigModal">
            {{ t('cancel') }}
          </VBtn>
          <VBtn color="primary" @click="handleSaveConfigurations">
            {{ t('save') }}
          </VBtn>
        </VCardText>
      </VCard>
    </VDialog>

    <Teleport to="body">
      <VCard
        v-if="isContextMenuOpen && contextMenuPosition"
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
  width: 24px;
  height: 24px;
  border: 4px solid white;
  border-radius: 50%;
  background-color: #b1b1b7;
  z-index: 10;
}

:deep(.vue-flow__handle.connectable) {
  cursor: crosshair;
}

:deep(.handle-target),
:deep(.vue-flow__handle.handle-target) {
  background-color: #4caf50 !important;
}

:deep(.handle-source),
:deep(.vue-flow__handle.handle-source) {
  background-color: #f44336 !important;
}

.flow-layout {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  height: 600px;
}

.node-menu {
  width: 220px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 4px;
  padding-right: 12px;
}

.vertical-divider {
  width: 1px;
  background-color: #e0e0e0;
  align-self: stretch;
}

.flow-area {
  flex: 1;
  height: 100%;
}

.actions-row {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-bottom: 16px;
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
