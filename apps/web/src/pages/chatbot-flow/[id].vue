<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { VueFlow } from '@vue-flow/core';
import type { Node, Edge, Connection, NodeChange } from '@vue-flow/core';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EChatbotPermissions } from '@core/common/enums/EPermissions/chatbot';
import ChatbotMenuNode from '@/components/chatbot/ChatbotMenuNode.vue';
import ChatbotStartNode from '@/components/chatbot/ChatbotStartNode.vue';
import ChatbotSatisfactionNode from '@/components/chatbot/ChatbotSatisfactionNode.vue';
import ChatbotRedirectNode from '@/components/chatbot/ChatbotRedirectNode.vue';
import ChatbotFinishNode from '@/components/chatbot/ChatbotFinishNode.vue';
import ChatbotTagNode from '@/components/chatbot/ChatbotTagNode.vue';
import { useChatbotStore } from '@/@webcore/stores/chatbot';
import { useI18n } from 'vue-i18n';

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

const route = useRoute();
const router = useRouter();
const chatbotStore = useChatbotStore();
const { t } = useI18n();

const chatbotId = computed(() => {
  const params = route.params as Record<string, string | string[]>;
  const id = params.id;
  return Array.isArray(id) ? id[0] : (id ?? '');
});
const chatbotName = ref('');

onMounted(async () => {
  await chatbotStore.listChatbots();
  const chatbot = chatbotStore.list.find(
    (cb) => cb.chatbot_id === chatbotId.value
  );
  if (chatbot) {
    chatbotName.value = chatbot.name;
  }
});

const nodeTypes = {
  menu: ChatbotMenuNode,
  start: ChatbotStartNode,
  satisfaction: ChatbotSatisfactionNode,
  redirect: ChatbotRedirectNode,
  finish: ChatbotFinishNode,
  tag: ChatbotTagNode,
};

const initialNodes: Node[] = [
  {
    id: '1',
    type: 'start',
    label: 'Início',
    position: { x: 250, y: 5 },
    draggable: false,
    data: {},
  },
];

const initialEdges: Edge[] = [];

const nodes = ref<Node[]>(initialNodes);
const edges = ref<Edge[]>(initialEdges);

let nodeIdCounter = 2;

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

const onConnect = (connection: Connection) => {
  const existingEdge = edges.value.find(
    (e) => e.source === connection.source && e.target === connection.target
  );
  if (existingEdge) return;

  edges.value.push({
    id: `e${connection.source}-${connection.target}-${Date.now()}`,
    source: connection.source!,
    target: connection.target!,
    markerEnd: {
      type: 'arrowclosed',
      color: '#1a192b',
    } as any,
    style: {
      stroke: '#1a192b',
      strokeWidth: 2,
    },
  });
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

const handleCancel = () => {
  router.push('/chatbot');
};

const handleSave = () => {
  // Por enquanto não faz nada
};
</script>

<template>
  <div>
    <VCard
      :title="`${t('configurations')} ${chatbotName ? `- ${chatbotName}` : t('chatbot')}`"
    >
      <VCardText>
        <div class="flow-layout">
          <div class="node-menu">
            <VBtn color="primary" @click="addMenuNode">
              <VIcon icon="tabler-menu-2" class="me-2" />
              Menu
            </VBtn>
            <VBtn color="warning" @click="addSatisfactionNode">
              <VIcon icon="tabler-star" class="me-2" />
              Satisfação
            </VBtn>
            <VDivider class="my-2" />
            <div class="text-caption text-medium-emphasis mb-2">Ações</div>
            <VBtn color="info" @click="addRedirectNode">
              <VIcon icon="tabler-arrow-forward" class="me-2" />
              Redirecionar
            </VBtn>
            <VBtn color="error" @click="addFinishNode">
              <VIcon icon="tabler-circle-check" class="me-2" />
              Finalizar
            </VBtn>
            <VBtn color="secondary" @click="addTagNode">
              <VIcon icon="tabler-tag" class="me-2" />
              Etiqueta
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

      <VDivider />

      <VCardText class="d-flex justify-end flex-wrap gap-3">
        <VBtn variant="tonal" color="secondary" @click="handleCancel">
          {{ t('cancel') }}
        </VBtn>
        <VBtn color="primary" @click="handleSave">
          {{ t('save') }}
        </VBtn>
      </VCardText>
    </VCard>
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
</style>
