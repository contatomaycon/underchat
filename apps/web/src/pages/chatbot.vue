<script setup lang="ts">
import { ref } from 'vue';
import { VueFlow } from '@vue-flow/core';
import type { Node, Edge, Connection, NodeChange } from '@vue-flow/core';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EChatboxPermissions } from '@core/common/enums/EPermissions/chatbox';
import ChatbotMenuNode from '@/components/chatbot/ChatbotMenuNode.vue';
import ChatbotStartNode from '@/components/chatbot/ChatbotStartNode.vue';
import ChatbotSatisfactionNode from '@/components/chatbot/ChatbotSatisfactionNode.vue';
import ChatbotRedirectNode from '@/components/chatbot/ChatbotRedirectNode.vue';
import ChatbotFinishNode from '@/components/chatbot/ChatbotFinishNode.vue';

definePage({
  meta: {
    permissions: [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EChatboxPermissions.chatbox_group,
      EChatboxPermissions.chatbox_access,
    ],
  },
});

const nodeTypes = {
  menu: ChatbotMenuNode,
  start: ChatbotStartNode,
  satisfaction: ChatbotSatisfactionNode,
  redirect: ChatbotRedirectNode,
  finish: ChatbotFinishNode,
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
      x: Math.random() * 400 + 100,
      y: Math.random() * 300 + 100,
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
      x: Math.random() * 400 + 100,
      y: Math.random() * 300 + 100,
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
      x: Math.random() * 400 + 100,
      y: Math.random() * 300 + 100,
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
      x: Math.random() * 400 + 100,
      y: Math.random() * 300 + 100,
    },
    data: {
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

const onNodesChange = (changes: NodeChange[]) => {
  changes.forEach((change) => {
    if (
      change.type === 'position' &&
      change.dragging === false &&
      change.position
    ) {
      const draggedNode = nodes.value.find((n) => n.id === change.id);
      if (!draggedNode) return;

      const otherNodes = nodes.value.filter((n) => n.id !== draggedNode.id);
      for (const otherNode of otherNodes) {
        const distance = Math.sqrt(
          Math.pow(draggedNode.position.x - otherNode.position.x, 2) +
            Math.pow(draggedNode.position.y - otherNode.position.y, 2)
        );

        if (distance < 80) {
          const existingEdge = edges.value.find(
            (e) => e.source === draggedNode.id && e.target === otherNode.id
          );
          if (!existingEdge) {
            const connection: Connection = {
              source: draggedNode.id,
              target: otherNode.id,
            };
            onConnect(connection);
          }
          break;
        }
      }
    }
  });
};
</script>

<template>
  <div>
    <VCard title="ChatBot Flow">
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
