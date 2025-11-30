<script setup lang="ts">
import { ref, markRaw, computed } from 'vue';
import { VueFlow } from '@vue-flow/core';
import type { Node, Edge, Connection, NodeChange } from '@vue-flow/core';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EChatbotPermissions } from '@core/common/enums/EPermissions/chatbot';
import { EColor } from '@core/common/enums/EColor';
import ChatbotMenuNode from '@/components/chatbot/ChatbotMenuNode.vue';
import ChatbotStartNode from '@/components/chatbot/ChatbotStartNode.vue';
import ChatbotSatisfactionNode from '@/components/chatbot/ChatbotSatisfactionNode.vue';
import ChatbotRedirectNode from '@/components/chatbot/ChatbotRedirectNode.vue';
import ChatbotFinishNode from '@/components/chatbot/ChatbotFinishNode.vue';
import ChatbotTagNode from '@/components/chatbot/ChatbotTagNode.vue';
import ChatbotMessageNode from '@/components/chatbot/ChatbotMessageNode.vue';
import ChatbotDataNode from '@/components/chatbot/ChatbotDataNode.vue';
import { useI18n } from 'vue-i18n';
import { useRouter, useRoute } from 'vue-router';
import DialogCloseBtn from '@/@webcore/components/DialogCloseBtn.vue';
import { useChatbotStore } from '@/@webcore/stores/chatbot';
import { getUser } from '@/@webcore/localStorage/user';
import { onMounted } from 'vue';

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
};

const { t } = useI18n();
const router = useRouter();
const route = useRoute();
const chatbotStore = useChatbotStore();

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

const inactivityUsers = ref<any[]>([]);
const inactivitySectors = ref<any[]>([]);
const inactivitySectorUsers = ref<any[]>([]);
const inactivityUserSearch = ref('');
const inactivitySectorSearch = ref('');
const inactivitySectorUserSearch = ref('');
const isLoadingInactivityUsers = ref(false);
const isLoadingInactivitySectors = ref(false);
const isLoadingInactivitySectorUsers = ref(false);
const isInactivityUserMenuOpen = ref(false);
const isInactivitySectorMenuOpen = ref(false);
const isInactivitySectorUserMenuOpen = ref(false);

const redirectFailedAttemptsUsers = ref<any[]>([]);
const redirectFailedAttemptsSectors = ref<any[]>([]);
const redirectFailedAttemptsSectorUsers = ref<any[]>([]);
const redirectFailedAttemptsUserSearch = ref('');
const redirectFailedAttemptsSectorSearch = ref('');
const redirectFailedAttemptsSectorUserSearch = ref('');
const isLoadingRedirectFailedAttemptsUsers = ref(false);
const isLoadingRedirectFailedAttemptsSectors = ref(false);
const isLoadingRedirectFailedAttemptsSectorUsers = ref(false);
const isRedirectFailedAttemptsUserMenuOpen = ref(false);
const isRedirectFailedAttemptsSectorMenuOpen = ref(false);
const isRedirectFailedAttemptsSectorUserMenuOpen = ref(false);

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

const filteredInactivityUsers = computed(() => {
  if (!inactivityUserSearch.value) {
    return inactivityUsers.value;
  }
  const query = inactivityUserSearch.value.toLowerCase();
  return inactivityUsers.value.filter((user) =>
    user?.title?.toLowerCase().includes(query)
  );
});

const filteredInactivitySectors = computed(() => {
  if (!inactivitySectorSearch.value) {
    return inactivitySectors.value;
  }
  const query = inactivitySectorSearch.value.toLowerCase();
  return inactivitySectors.value.filter((sector) =>
    sector.title.toLowerCase().includes(query)
  );
});

const filteredInactivitySectorUsers = computed(() => {
  if (
    !inactivitySectorUsers.value ||
    inactivitySectorUsers.value.length === 0
  ) {
    return [];
  }
  if (!inactivitySectorUserSearch.value) {
    return inactivitySectorUsers.value;
  }
  const query = inactivitySectorUserSearch.value.toLowerCase();
  return inactivitySectorUsers.value.filter((user) =>
    user?.title?.toLowerCase().includes(query)
  );
});

const filteredRedirectFailedAttemptsUsers = computed(() => {
  if (!redirectFailedAttemptsUserSearch.value) {
    return redirectFailedAttemptsUsers.value;
  }
  const query = redirectFailedAttemptsUserSearch.value.toLowerCase();
  return redirectFailedAttemptsUsers.value.filter((user) =>
    user?.title?.toLowerCase().includes(query)
  );
});

const filteredRedirectFailedAttemptsSectors = computed(() => {
  if (!redirectFailedAttemptsSectorSearch.value) {
    return redirectFailedAttemptsSectors.value;
  }
  const query = redirectFailedAttemptsSectorSearch.value.toLowerCase();
  return redirectFailedAttemptsSectors.value.filter((sector) =>
    sector.title.toLowerCase().includes(query)
  );
});

const filteredRedirectFailedAttemptsSectorUsers = computed(() => {
  if (
    !redirectFailedAttemptsSectorUsers.value ||
    redirectFailedAttemptsSectorUsers.value.length === 0
  ) {
    return [];
  }
  if (!redirectFailedAttemptsSectorUserSearch.value) {
    return redirectFailedAttemptsSectorUsers.value;
  }
  const query = redirectFailedAttemptsSectorUserSearch.value.toLowerCase();
  return redirectFailedAttemptsSectorUsers.value.filter((user) =>
    user?.title?.toLowerCase().includes(query)
  );
});

const onKeyPress = (event: KeyboardEvent) => {
  const char = event.key;
  if (
    !/[0-9]/.test(char) &&
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

watch(isInactivityUserMenuOpen, (isOpen) => {
  if (isOpen) {
    loadInactivityUsers();
  } else {
    inactivityUserSearch.value = '';
  }
});

watch(isInactivitySectorMenuOpen, (isOpen) => {
  if (isOpen) {
    loadInactivitySectors();
  } else {
    inactivitySectorSearch.value = '';
  }
});

watch(isInactivitySectorUserMenuOpen, (isOpen) => {
  if (isOpen && inactivityAlertSelectedSector.value) {
    loadInactivitySectorUsers(inactivityAlertSelectedSector.value);
  } else {
    inactivitySectorUserSearch.value = '';
  }
});

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

watch(isRedirectFailedAttemptsUserMenuOpen, (isOpen) => {
  if (isOpen) {
    loadRedirectFailedAttemptsUsers();
  } else {
    redirectFailedAttemptsUserSearch.value = '';
  }
});

watch(isRedirectFailedAttemptsSectorMenuOpen, (isOpen) => {
  if (isOpen) {
    loadRedirectFailedAttemptsSectors();
  } else {
    redirectFailedAttemptsSectorSearch.value = '';
  }
});

watch(isRedirectFailedAttemptsSectorUserMenuOpen, (isOpen) => {
  if (isOpen && redirectFailedAttemptsSelectedSector.value) {
    loadRedirectFailedAttemptsSectorUsers(
      redirectFailedAttemptsSelectedSector.value
    );
  } else {
    redirectFailedAttemptsSectorUserSearch.value = '';
  }
});

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

let nodeIdCounter = 2;
const optionNodeTypes = ['menu', 'satisfaction'];

const normalizeHandleId = (handle?: string | null): string | null => {
  if (!handle) {
    return null;
  }

  const normalized = handle
    .toString()
    .trim()
    .replace(/^(option-)+/i, '')
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
  const sourceNode = nodes.value.find((n) => n.id === edge.source);
  const shouldNormalize =
    sourceNode && optionNodeTypes.includes(sourceNode.type as string);

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

  return {
    ...edge,
    sourceHandle: normalizedSourceHandle,
    targetHandle: edge.targetHandle ? String(edge.targetHandle) : undefined,
  };
};

const normalizeConnectionSourceHandle = (
  connection: Connection
): string | undefined => {
  const sourceNode = nodes.value.find((n) => n.id === connection.source);
  const shouldNormalize =
    sourceNode && optionNodeTypes.includes(sourceNode.type as string);

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

const addMenuNode = () => {
  const newNode: Node = {
    id: `menu-${nodeIdCounter++}`,
    type: 'menu',
    position: {
      x: getSecureRandom(400) + 100,
      y: getSecureRandom(300) + 100,
    },
    data: {
      title: '',
      message: '',
      options: [],
      onRemove: () => removeNode(newNode.id),
    },
  };
  nodes.value.push(newNode);
};

const addSatisfactionNode = () => {
  const newNode: Node = {
    id: `satisfaction-${nodeIdCounter++}`,
    type: 'satisfaction',
    position: {
      x: getSecureRandom(400) + 100,
      y: getSecureRandom(300) + 100,
    },
    data: {
      title: '',
      message: '',
      options: [],
      onRemove: () => removeNode(newNode.id),
    },
  };
  nodes.value.push(newNode);
};

const addRedirectNode = () => {
  const newNode: Node = {
    id: `redirect-${nodeIdCounter++}`,
    type: 'redirect',
    position: {
      x: getSecureRandom(400) + 100,
      y: getSecureRandom(300) + 100,
    },
    data: {
      redirectType: null,
      selectedUser: null,
      selectedSector: null,
      selectedSectorUser: null,
      onRemove: () => removeNode(newNode.id),
    },
  };
  nodes.value.push(newNode);
};

const addFinishNode = () => {
  const newNode: Node = {
    id: `finish-${nodeIdCounter++}`,
    type: 'finish',
    position: {
      x: getSecureRandom(400) + 100,
      y: getSecureRandom(300) + 100,
    },
    data: {
      onRemove: () => removeNode(newNode.id),
    },
  };
  nodes.value.push(newNode);
};

const addTagNode = () => {
  const newNode: Node = {
    id: `tag-${nodeIdCounter++}`,
    type: 'tag',
    position: {
      x: getSecureRandom(400) + 100,
      y: getSecureRandom(300) + 100,
    },
    data: {
      tagType: null,
      selectedTag: null,
      onRemove: () => removeNode(newNode.id),
    },
  };
  nodes.value.push(newNode);
};

const addMessageNode = () => {
  const newNode: Node = {
    id: `message-${nodeIdCounter++}`,
    type: 'message',
    position: {
      x: getSecureRandom(400) + 100,
      y: getSecureRandom(300) + 100,
    },
    data: {
      messageType: null,
      text: '',
      attachmentFile: null,
      continueType: null,
      onRemove: () => removeNode(newNode.id),
    },
  };
  nodes.value.push(newNode);
};

const addDataNode = () => {
  const newNode: Node = {
    id: `data-${nodeIdCounter++}`,
    type: 'data',
    position: {
      x: getSecureRandom(400) + 100,
      y: getSecureRandom(300) + 100,
    },
    data: {
      dataType: null,
      firstName: '',
      lastName: '',
      email: '',
      cpf: '',
      cnpj: '',
      onRemove: () => removeNode(newNode.id),
    },
  };
  nodes.value.push(newNode);
};

const onConnect = (connection: Connection) => {
  const normalizedSourceHandle = normalizeConnectionSourceHandle(connection);
  const normalizedTargetHandle = connection.targetHandle
    ? String(connection.targetHandle)
    : undefined;

  const existingEdge = edges.value.find(
    (e) =>
      e.source === connection.source &&
      e.target === connection.target &&
      e.sourceHandle === normalizedSourceHandle &&
      e.targetHandle === normalizedTargetHandle
  );
  if (existingEdge) return;

  const newEdge = normalizeEdge({
    id: `e${connection.source}-${connection.target}-${normalizedSourceHandle || ''}-${normalizedTargetHandle || ''}-${Date.now()}`,
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

const prepareNodesForSave = (nodesToSave: Node[]) => {
  return nodesToSave.map((node) => {
    const nodeData = { ...node.data };
    if (nodeData && 'attachmentFile' in nodeData) {
      delete nodeData.attachmentFile;
    }
    if (nodeData && 'onRemove' in nodeData) {
      delete nodeData.onRemove;
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

  isLoadingFlow.value = true;

  try {
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

    const result = await chatbotStore.saveChatbotFlow({
      chatbot_id: chatbotId.value,
      nodes: preparedNodes,
      edges: preparedEdges,
    });

    if (result) {
    }
  } catch (error) {
    console.error('Error saving flow:', error);
  } finally {
    isLoadingFlow.value = false;
  }
};

const loadChatbotFlow = async () => {
  if (!chatbotId.value) {
    return;
  }

  isLoadingFlow.value = true;

  try {
    const flow = await chatbotStore.listChatbotFlow(chatbotId.value);

    if (flow) {
      if (flow.nodes && flow.nodes.length > 0) {
        const loadedNodes = flow.nodes as Node[];

        nodes.value = loadedNodes.map((node) => {
          if (node.type !== 'start') {
            node.draggable = true;
            if (!node.data) {
              node.data = {};
            }
            node.data.onRemove = () => removeNode(node.id);
          } else {
            node.draggable = false;
            if (!node.data) {
              node.data = {};
            }
          }
          if (node.type === 'menu' && !node.data.options) {
            node.data.options = [];
          }
          if (node.type === 'satisfaction' && !node.data.options) {
            node.data.options = [];
          }
          if (node.type === 'redirect') {
            if (node.data.redirectType === undefined)
              node.data.redirectType = null;
            if (node.data.selectedUser === undefined)
              node.data.selectedUser = null;
            if (node.data.selectedSector === undefined)
              node.data.selectedSector = null;
            if (node.data.selectedSectorUser === undefined)
              node.data.selectedSectorUser = null;
          }
          if (node.type === 'tag') {
            if (node.data.tagType === undefined) node.data.tagType = null;
            if (node.data.selectedTag === undefined)
              node.data.selectedTag = null;
          }
          if (node.type === 'message') {
            if (node.data.messageType === undefined)
              node.data.messageType = null;
            if (node.data.text === undefined) node.data.text = '';
            if (node.data.attachmentFile === undefined)
              node.data.attachmentFile = null;
            if (node.data.continueType === undefined)
              node.data.continueType = null;
          }
          if (node.type === 'data') {
            if (node.data.dataType === undefined) node.data.dataType = null;
            if (node.data.firstName === undefined) node.data.firstName = '';
            if (node.data.lastName === undefined) node.data.lastName = '';
            if (node.data.email === undefined) node.data.email = '';
            if (node.data.cpf === undefined) node.data.cpf = '';
            if (node.data.cnpj === undefined) node.data.cnpj = '';
          }

          return node;
        });

        const maxId = loadedNodes.reduce((max, node) => {
          const match = node.id.match(/\d+$/);
          if (match) {
            const num = parseInt(match[0], 10);
            return Math.max(max, num);
          }
          return max;
        }, 0);
        nodeIdCounter = maxId + 1;
      } else {
        nodes.value = initialNodes;
      }

      if (flow.edges && flow.edges.length > 0) {
        edges.value = (flow.edges as Edge[]).map((edge) => {
          const baseEdge: Edge = {
            id: edge.id,
            source: edge.source,
            target: edge.target,
            sourceHandle: edge.sourceHandle
              ? String(edge.sourceHandle)
              : undefined,
            targetHandle: edge.targetHandle
              ? String(edge.targetHandle)
              : undefined,
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
          };

          return normalizeEdge(baseEdge);
        });
      } else {
        edges.value = [];
      }
    }
  } catch (error) {
    console.error('Error loading flow:', error);
  } finally {
    isLoadingFlow.value = false;
  }
};

const loadChatbotFlowConfigurations = async () => {
  if (!chatbotId.value) {
    return;
  }

  try {
    await loadInactivitySectors();
    await loadInactivityUsers();
    await loadRedirectFailedAttemptsSectors();
    await loadRedirectFailedAttemptsUsers();

    const configurations = await chatbotStore.listChatbotFlowConfigurations(
      chatbotId.value
    );

    if (configurations && configurations.configurations) {
      const configs = configurations.configurations;

      if (configs.inactivity_alert) {
        const config = configs.inactivity_alert;
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
      }

      if (configs.redirect_failed_attempts) {
        const config = configs.redirect_failed_attempts;
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
      }
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
                ? parseInt(inactivityAlertQuantity.value)
                : undefined,
              time: inactivityAlertTime.value
                ? parseInt(inactivityAlertTime.value)
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
                ? parseInt(redirectFailedAttemptsQuantity.value)
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

onMounted(() => {
  loadChatbotFlow();
});
</script>

<template>
  <div>
    <VCard :title="`${t('configurations')} ${t('chatbot')}`">
      <VCardText>
        <div class="actions-row">
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
            <VBtn color="primary" @click="addMenuNode">
              <VIcon icon="tabler-menu-2" class="me-2" />
              {{ t('chatbot_menu') }}
            </VBtn>
            <VBtn color="warning" @click="addSatisfactionNode">
              <VIcon icon="tabler-star" class="me-2" />
              {{ t('chatbot_satisfaction') }}
            </VBtn>
            <VDivider class="my-2" />
            <div class="text-caption text-medium-emphasis mb-2">
              {{ t('chatbot_options') }}
            </div>
            <VBtn color="info" @click="addRedirectNode">
              <VIcon icon="tabler-arrow-forward" class="me-2" />
              {{ t('chatbot_redirect') }}
            </VBtn>
            <VBtn color="error" @click="addFinishNode">
              <VIcon icon="tabler-circle-check" class="me-2" />
              {{ t('chatbot_finish') }}
            </VBtn>
            <VBtn color="secondary" @click="addTagNode">
              <VIcon icon="tabler-tag" class="me-2" />
              {{ t('chatbot_tag_node_title') }}
            </VBtn>
            <VBtn color="success" @click="addMessageNode">
              <VIcon icon="tabler-message" class="me-2" />
              {{ t('chatbot_message') }}
            </VBtn>
            <VBtn color="info" @click="addDataNode">
              <VIcon icon="tabler-database" class="me-2" />
              {{ t('chatbot_data') }}
            </VBtn>
          </div>
          <div class="vertical-divider" />
          <div class="flow-area">
            <VueFlow
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
            />
          </div>
        </div>
      </VCardText>
    </VCard>

    <VDialog v-model="isConfigModalOpen" max-width="600" persistent>
      <DialogCloseBtn @click="closeConfigModal" />

      <VCard :title="t('chatbot_configurations')">
        <VCardText>
          <VCard variant="outlined" class="mb-4">
            <VCardTitle class="text-body-1 pa-3 font-weight-bold">
              {{ t('chatbot_inactivity_alert') }}
            </VCardTitle>
            <VCardSubtitle class="text-caption pa-3 pt-0 config-description">
              {{ t('chatbot_inactivity_alert_description') }}
            </VCardSubtitle>
            <VDivider />
            <VCardText>
              <div class="mb-3">
                <VLabel class="mb-1 text-body-2">{{
                  t('chatbot_inactivity_alert')
                }}</VLabel>
                <VSelect
                  v-model="inactivityAlertStatus"
                  :items="[
                    {
                      value: 'active',
                      title: t('chatbot_inactivity_alert_active'),
                    },
                    {
                      value: 'inactive',
                      title: t('chatbot_inactivity_alert_inactive'),
                    },
                  ]"
                  item-title="title"
                  item-value="value"
                  variant="outlined"
                  density="compact"
                  hide-details
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
                  <VSelect
                    v-model="inactivityAlertAction"
                    :items="[
                      { value: 'redirect', title: t('chatbot_redirect') },
                      { value: 'finish', title: t('chatbot_finish') },
                    ]"
                    item-title="title"
                    item-value="value"
                    variant="outlined"
                    density="compact"
                    hide-details
                  />
                </div>

                <div v-if="showInactivityAlertRedirectFields">
                  <div class="mb-3">
                    <VLabel class="mb-1 text-body-2">{{
                      t('chatbot_redirect_to')
                    }}</VLabel>
                    <VSelect
                      v-model="inactivityAlertRedirectType"
                      :items="[
                        { value: 'user', title: t('chatbot_redirect_user') },
                        {
                          value: 'sector',
                          title: t('chatbot_redirect_sector'),
                        },
                      ]"
                      item-title="title"
                      item-value="value"
                      variant="outlined"
                      density="compact"
                      hide-details
                    />
                  </div>

                  <div v-if="showInactivityAlertUserField" class="mb-3">
                    <VLabel class="mb-1 text-body-2">{{
                      t('chatbot_user_label')
                    }}</VLabel>
                    <VMenu v-model="isInactivityUserMenuOpen">
                      <template #activator="{ props: menuProps }">
                        <VTextField
                          v-bind="menuProps"
                          :model-value="
                            inactivityUsers.find(
                              (u) => u.value === inactivityAlertSelectedUser
                            )?.title || ''
                          "
                          :placeholder="t('chatbot_search')"
                          variant="outlined"
                          readonly
                          append-inner-icon="tabler-chevron-down"
                          :loading="isLoadingInactivityUsers"
                          density="compact"
                        />
                      </template>
                      <VCard>
                        <VCardText>
                          <VTextField
                            v-model="inactivityUserSearch"
                            :placeholder="t('chatbot_search_user')"
                            variant="outlined"
                            density="compact"
                            prepend-inner-icon="tabler-search"
                            hide-details
                          />
                        </VCardText>
                        <VDivider />
                        <VList density="compact" class="max-height-300">
                          <VListItem
                            v-for="user in filteredInactivityUsers"
                            :key="user.value"
                            :value="user.value"
                            @click="
                              inactivityAlertSelectedUser = user.value;
                              isInactivityUserMenuOpen = false;
                            "
                          >
                            <template #prepend>
                              <VAvatar
                                size="32"
                                :variant="!user.photo ? 'tonal' : undefined"
                                color="primary"
                              >
                                <VImg
                                  v-if="user.photo"
                                  :src="user.photo"
                                  :alt="user.title"
                                />
                                <VIcon v-else icon="tabler-user" size="18" />
                              </VAvatar>
                            </template>
                            <VListItemTitle>{{ user.title }}</VListItemTitle>
                            <template #append v-if="user.status === 'online'">
                              <VChip
                                size="small"
                                color="success"
                                variant="tonal"
                              >
                                {{ t('chatbot_online') }}
                              </VChip>
                            </template>
                          </VListItem>
                          <VListItem
                            v-if="
                              filteredInactivityUsers.length === 0 &&
                              !isLoadingInactivityUsers
                            "
                            disabled
                          >
                            <VListItemTitle
                              class="text-center text-body-2 text-medium-emphasis"
                            >
                              {{ t('chatbot_no_results_found') }}
                            </VListItemTitle>
                          </VListItem>
                        </VList>
                      </VCard>
                    </VMenu>
                  </div>

                  <div v-if="showInactivityAlertSectorField" class="mb-3">
                    <VLabel class="mb-1 text-body-2">{{
                      t('chatbot_sector_label')
                    }}</VLabel>
                    <VMenu v-model="isInactivitySectorMenuOpen">
                      <template #activator="{ props: menuProps }">
                        <VTextField
                          v-bind="menuProps"
                          :model-value="
                            inactivitySectors.find(
                              (s) => s.value === inactivityAlertSelectedSector
                            )?.title || ''
                          "
                          :placeholder="t('chatbot_search')"
                          variant="outlined"
                          readonly
                          append-inner-icon="tabler-chevron-down"
                          :loading="isLoadingInactivitySectors"
                          density="compact"
                        />
                      </template>
                      <VCard>
                        <VCardText>
                          <VTextField
                            v-model="inactivitySectorSearch"
                            :placeholder="t('chatbot_search_sector')"
                            variant="outlined"
                            density="compact"
                            prepend-inner-icon="tabler-search"
                            hide-details
                          />
                        </VCardText>
                        <VDivider />
                        <VList density="compact" class="max-height-300">
                          <VListItem
                            v-for="sector in filteredInactivitySectors"
                            :key="sector.value"
                            :value="sector.value"
                            @click="
                              inactivityAlertSelectedSector = sector.value;
                              isInactivitySectorMenuOpen = false;
                            "
                          >
                            <template #prepend>
                              <VAvatar
                                size="24"
                                :style="{
                                  backgroundColor: sector.color || '#1976D2',
                                }"
                              />
                            </template>
                            <VListItemTitle>{{ sector.title }}</VListItemTitle>
                          </VListItem>
                          <VListItem
                            v-if="
                              filteredInactivitySectors.length === 0 &&
                              !isLoadingInactivitySectors
                            "
                            disabled
                          >
                            <VListItemTitle
                              class="text-center text-body-2 text-medium-emphasis"
                            >
                              {{ t('chatbot_no_results_found') }}
                            </VListItemTitle>
                          </VListItem>
                        </VList>
                      </VCard>
                    </VMenu>
                  </div>

                  <div v-if="showInactivityAlertSectorUserField" class="mb-3">
                    <VLabel class="mb-1 text-body-2">{{
                      t('chatbot_sector_user_label')
                    }}</VLabel>
                    <VMenu v-model="isInactivitySectorUserMenuOpen">
                      <template #activator="{ props: menuProps }">
                        <VTextField
                          v-bind="menuProps"
                          :model-value="
                            inactivitySectorUsers.find(
                              (u) =>
                                u.value === inactivityAlertSelectedSectorUser
                            )?.title || ''
                          "
                          :placeholder="t('chatbot_search_optional')"
                          variant="outlined"
                          readonly
                          :loading="isLoadingInactivitySectorUsers"
                          density="compact"
                        >
                          <template #append-inner>
                            <VIcon
                              v-if="inactivityAlertSelectedSectorUser"
                              icon="tabler-x"
                              size="20"
                              class="cursor-pointer me-1"
                              @click.stop="
                                inactivityAlertSelectedSectorUser = null;
                                isInactivitySectorUserMenuOpen = false;
                              "
                            />
                            <VIcon icon="tabler-chevron-down" size="20" />
                          </template>
                        </VTextField>
                      </template>
                      <VCard>
                        <VCardText>
                          <VTextField
                            v-model="inactivitySectorUserSearch"
                            :placeholder="t('chatbot_search_user')"
                            variant="outlined"
                            density="compact"
                            prepend-inner-icon="tabler-search"
                            hide-details
                          />
                        </VCardText>
                        <VDivider />
                        <VList density="compact" class="max-height-300">
                          <VListItem
                            v-for="user in filteredInactivitySectorUsers"
                            :key="user.value"
                            :value="user.value"
                            @click="
                              inactivityAlertSelectedSectorUser = user.value;
                              isInactivitySectorUserMenuOpen = false;
                            "
                          >
                            <template #prepend>
                              <VAvatar
                                size="32"
                                :variant="!user.photo ? 'tonal' : undefined"
                                color="primary"
                              >
                                <VImg
                                  v-if="user.photo"
                                  :src="user.photo"
                                  :alt="user.title"
                                />
                                <VIcon v-else icon="tabler-user" size="18" />
                              </VAvatar>
                            </template>
                            <VListItemTitle>{{ user.title }}</VListItemTitle>
                            <template #append v-if="user.status === 'online'">
                              <VChip
                                size="small"
                                color="success"
                                variant="tonal"
                              >
                                {{ t('chatbot_online') }}
                              </VChip>
                            </template>
                          </VListItem>
                          <VListItem
                            v-if="
                              filteredInactivitySectorUsers.length === 0 &&
                              !isLoadingInactivitySectorUsers
                            "
                            disabled
                          >
                            <VListItemTitle
                              class="text-center text-body-2 text-medium-emphasis"
                            >
                              {{ t('chatbot_no_results_found') }}
                            </VListItemTitle>
                          </VListItem>
                        </VList>
                      </VCard>
                    </VMenu>
                  </div>
                </div>
              </div>
            </VCardText>
          </VCard>

          <VCard variant="outlined" class="mb-4">
            <VCardTitle class="text-body-1 pa-3 font-weight-bold">
              {{ t('chatbot_redirect_failed_attempts') }}
            </VCardTitle>
            <VCardSubtitle class="text-caption pa-3 pt-0 config-description">
              {{ t('chatbot_redirect_failed_attempts_description') }}
            </VCardSubtitle>
            <VDivider />
            <VCardText>
              <div class="mb-3">
                <VLabel class="mb-1 text-body-2">{{
                  t('chatbot_redirect_failed_attempts')
                }}</VLabel>
                <VSelect
                  v-model="redirectFailedAttemptsStatus"
                  :items="[
                    {
                      value: 'active',
                      title: t('chatbot_redirect_failed_attempts_active'),
                    },
                    {
                      value: 'inactive',
                      title: t('chatbot_redirect_failed_attempts_inactive'),
                    },
                  ]"
                  item-title="title"
                  item-value="value"
                  variant="outlined"
                  density="compact"
                  hide-details
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
                          redirectFailedAttemptsQuantityComputed = numericValue;
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
                  <VSelect
                    v-model="redirectFailedAttemptsRedirectType"
                    :items="[
                      { value: 'user', title: t('chatbot_redirect_user') },
                      { value: 'sector', title: t('chatbot_redirect_sector') },
                    ]"
                    item-title="title"
                    item-value="value"
                    variant="outlined"
                    density="compact"
                    hide-details
                  />
                </div>

                <div v-if="showRedirectFailedAttemptsUserField" class="mb-3">
                  <VLabel class="mb-1 text-body-2">{{
                    t('chatbot_user_label')
                  }}</VLabel>
                  <VMenu v-model="isRedirectFailedAttemptsUserMenuOpen">
                    <template #activator="{ props: menuProps }">
                      <VTextField
                        v-bind="menuProps"
                        :model-value="
                          redirectFailedAttemptsUsers.find(
                            (u) =>
                              u.value === redirectFailedAttemptsSelectedUser
                          )?.title || ''
                        "
                        :placeholder="t('chatbot_search')"
                        variant="outlined"
                        readonly
                        append-inner-icon="tabler-chevron-down"
                        :loading="isLoadingRedirectFailedAttemptsUsers"
                        density="compact"
                      />
                    </template>
                    <VCard>
                      <VCardText>
                        <VTextField
                          v-model="redirectFailedAttemptsUserSearch"
                          :placeholder="t('chatbot_search_user')"
                          variant="outlined"
                          density="compact"
                          prepend-inner-icon="tabler-search"
                          hide-details
                        />
                      </VCardText>
                      <VDivider />
                      <VList density="compact" class="max-height-300">
                        <VListItem
                          v-for="user in filteredRedirectFailedAttemptsUsers"
                          :key="user.value"
                          :value="user.value"
                          @click="
                            redirectFailedAttemptsSelectedUser = user.value;
                            isRedirectFailedAttemptsUserMenuOpen = false;
                          "
                        >
                          <template #prepend>
                            <VAvatar
                              size="32"
                              :variant="!user.photo ? 'tonal' : undefined"
                              color="primary"
                            >
                              <VImg
                                v-if="user.photo"
                                :src="user.photo"
                                :alt="user.title"
                              />
                              <VIcon v-else icon="tabler-user" size="18" />
                            </VAvatar>
                          </template>
                          <VListItemTitle>{{ user.title }}</VListItemTitle>
                          <template #append v-if="user.status === 'online'">
                            <VChip size="small" color="success" variant="tonal">
                              {{ t('chatbot_online') }}
                            </VChip>
                          </template>
                        </VListItem>
                        <VListItem
                          v-if="
                            filteredRedirectFailedAttemptsUsers.length === 0 &&
                            !isLoadingRedirectFailedAttemptsUsers
                          "
                          disabled
                        >
                          <VListItemTitle
                            class="text-center text-body-2 text-medium-emphasis"
                          >
                            {{ t('chatbot_no_results_found') }}
                          </VListItemTitle>
                        </VListItem>
                      </VList>
                    </VCard>
                  </VMenu>
                </div>

                <div v-if="showRedirectFailedAttemptsSectorField" class="mb-3">
                  <VLabel class="mb-1 text-body-2">{{
                    t('chatbot_sector_label')
                  }}</VLabel>
                  <VMenu v-model="isRedirectFailedAttemptsSectorMenuOpen">
                    <template #activator="{ props: menuProps }">
                      <VTextField
                        v-bind="menuProps"
                        :model-value="
                          redirectFailedAttemptsSectors.find(
                            (s) =>
                              s.value === redirectFailedAttemptsSelectedSector
                          )?.title || ''
                        "
                        :placeholder="t('chatbot_search')"
                        variant="outlined"
                        readonly
                        append-inner-icon="tabler-chevron-down"
                        :loading="isLoadingRedirectFailedAttemptsSectors"
                        density="compact"
                      />
                    </template>
                    <VCard>
                      <VCardText>
                        <VTextField
                          v-model="redirectFailedAttemptsSectorSearch"
                          :placeholder="t('chatbot_search_sector')"
                          variant="outlined"
                          density="compact"
                          prepend-inner-icon="tabler-search"
                          hide-details
                        />
                      </VCardText>
                      <VDivider />
                      <VList density="compact" class="max-height-300">
                        <VListItem
                          v-for="sector in filteredRedirectFailedAttemptsSectors"
                          :key="sector.value"
                          :value="sector.value"
                          @click="
                            redirectFailedAttemptsSelectedSector = sector.value;
                            isRedirectFailedAttemptsSectorMenuOpen = false;
                          "
                        >
                          <template #prepend>
                            <VAvatar
                              size="24"
                              :style="{
                                backgroundColor: sector.color || '#1976D2',
                              }"
                            />
                          </template>
                          <VListItemTitle>{{ sector.title }}</VListItemTitle>
                        </VListItem>
                        <VListItem
                          v-if="
                            filteredRedirectFailedAttemptsSectors.length ===
                              0 && !isLoadingRedirectFailedAttemptsSectors
                          "
                          disabled
                        >
                          <VListItemTitle
                            class="text-center text-body-2 text-medium-emphasis"
                          >
                            {{ t('chatbot_no_results_found') }}
                          </VListItemTitle>
                        </VListItem>
                      </VList>
                    </VCard>
                  </VMenu>
                </div>

                <div
                  v-if="showRedirectFailedAttemptsSectorUserField"
                  class="mb-3"
                >
                  <VLabel class="mb-1 text-body-2">{{
                    t('chatbot_sector_user_label')
                  }}</VLabel>
                  <VMenu v-model="isRedirectFailedAttemptsSectorUserMenuOpen">
                    <template #activator="{ props: menuProps }">
                      <VTextField
                        v-bind="menuProps"
                        :model-value="
                          redirectFailedAttemptsSectorUsers.find(
                            (u) =>
                              u.value ===
                              redirectFailedAttemptsSelectedSectorUser
                          )?.title || ''
                        "
                        :placeholder="t('chatbot_search_optional')"
                        variant="outlined"
                        readonly
                        :loading="isLoadingRedirectFailedAttemptsSectorUsers"
                        density="compact"
                      >
                        <template #append-inner>
                          <VIcon
                            v-if="redirectFailedAttemptsSelectedSectorUser"
                            icon="tabler-x"
                            size="20"
                            class="cursor-pointer me-1"
                            @click.stop="
                              redirectFailedAttemptsSelectedSectorUser = null;
                              isRedirectFailedAttemptsSectorUserMenuOpen = false;
                            "
                          />
                          <VIcon icon="tabler-chevron-down" size="20" />
                        </template>
                      </VTextField>
                    </template>
                    <VCard>
                      <VCardText>
                        <VTextField
                          v-model="redirectFailedAttemptsSectorUserSearch"
                          :placeholder="t('chatbot_search_user')"
                          variant="outlined"
                          density="compact"
                          prepend-inner-icon="tabler-search"
                          hide-details
                        />
                      </VCardText>
                      <VDivider />
                      <VList density="compact" class="max-height-300">
                        <VListItem
                          v-for="user in filteredRedirectFailedAttemptsSectorUsers"
                          :key="user.value"
                          :value="user.value"
                          @click="
                            redirectFailedAttemptsSelectedSectorUser =
                              user.value;
                            isRedirectFailedAttemptsSectorUserMenuOpen = false;
                          "
                        >
                          <template #prepend>
                            <VAvatar
                              size="32"
                              :variant="!user.photo ? 'tonal' : undefined"
                              color="primary"
                            >
                              <VImg
                                v-if="user.photo"
                                :src="user.photo"
                                :alt="user.title"
                              />
                              <VIcon v-else icon="tabler-user" size="18" />
                            </VAvatar>
                          </template>
                          <VListItemTitle>{{ user.title }}</VListItemTitle>
                          <template #append v-if="user.status === 'online'">
                            <VChip size="small" color="success" variant="tonal">
                              {{ t('chatbot_online') }}
                            </VChip>
                          </template>
                        </VListItem>
                        <VListItem
                          v-if="
                            filteredRedirectFailedAttemptsSectorUsers.length ===
                              0 && !isLoadingRedirectFailedAttemptsSectorUsers
                          "
                          disabled
                        >
                          <VListItemTitle
                            class="text-center text-body-2 text-medium-emphasis"
                          >
                            {{ t('chatbot_no_results_found') }}
                          </VListItemTitle>
                        </VListItem>
                      </VList>
                    </VCard>
                  </VMenu>
                </div>
              </div>
            </VCardText>
          </VCard>
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
  width: 16px;
  height: 16px;
  border: 3px solid white;
  border-radius: 50%;
  background-color: #b1b1b7;
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
</style>
