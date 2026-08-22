<script setup lang="ts">
import './chatbot-node-workbench.css';
import { ref, computed, watch, onMounted } from 'vue';
import type { NodeProps } from '@vue-flow/core';
import { Handle, Position } from '@vue-flow/core';
import { useChatbotStore } from '@/@webcore/stores/chatbot';
import { useI18n } from 'vue-i18n';

interface TagData {
  tagType: 'chat' | 'contact' | null;
  selectedTag: string[];
  onRemove?: () => void;
}

const props = defineProps<NodeProps>();
const chatbotStore = useChatbotStore();
const { t } = useI18n();

const getInitialData = (): TagData => {
  const data = props.data as TagData | undefined;
  return {
    tagType: data?.tagType || null,
    selectedTag: Array.isArray(data?.selectedTag) ? data.selectedTag : [],
  };
};

const tagData = ref<TagData>(getInitialData());

const tags = ref<Array<{ value: string; title: string; color: string | null }>>(
  []
);
const isLoadingTags = ref(false);

const updateNodeData = () => {
  if (props.data) {
    const data = props.data as TagData;
    data.tagType = tagData.value.tagType;
    data.selectedTag = tagData.value.selectedTag;
  }
};

const loadTags = async () => {
  if (isLoadingTags.value) return;

  isLoadingTags.value = true;
  try {
    const tagsList = await chatbotStore.listChatbotTags();

    tags.value = tagsList.map((tag) => ({
      value: tag.label_template_id,
      title: tag.label,
      color: tag.color || null,
    }));

    for (const selectedTagId of tagData.value.selectedTag) {
      if (selectedTagId && !tags.value.some((t) => t.value === selectedTagId)) {
        tags.value.unshift({
          value: selectedTagId,
          title: selectedTagId,
          color: null,
        });
      }
    }
  } catch (error) {
    console.error('Error loading tags:', error);
    tags.value = [];
  } finally {
    isLoadingTags.value = false;
  }
};

onMounted(() => {
  if (tagData.value.tagType) {
    loadTags();
  }
});

watch(
  () => tagData.value.tagType,
  (newType) => {
    if (!newType) {
      tagData.value.selectedTag = [];
      tags.value = [];
    } else if (tags.value.length === 0) {
      loadTags();
    }
    updateNodeData();
  }
);

watch(
  () => tagData.value,
  () => {
    updateNodeData();
  },
  { deep: true }
);

const handleRemove = () => {
  const data = props.data as TagData;
  if (data?.onRemove) {
    data.onRemove();
  }
};
</script>

<template>
  <div class="chatbot-tag-node chatbot-workbench-node">
    <Handle
      id="target"
      type="target"
      :position="Position.Top"
      class="handle-target"
    />
    <Handle
      id="source"
      type="source"
      :position="Position.Bottom"
      class="handle-source"
    />

    <VCard class="tag-card chatbot-workbench-card" elevation="2">
      <VCardTitle
        class="d-flex align-center justify-space-between pa-2 node-drag-handle chatbot-workbench-header"
      >
        <div class="d-flex align-center ga-2 chatbot-workbench-identity">
          <VIcon
            icon="tabler-tag"
            color="secondary"
            size="20"
            class="chatbot-workbench-icon"
          />
          <span class="text-sm font-weight-medium chatbot-workbench-title">{{
            t('chatbot_tag_node_title')
          }}</span>
        </div>
        <VIcon
          v-if="(props.data as TagData)?.onRemove"
          icon="tabler-x"
          size="18"
          color="error"
          class="cursor-pointer chatbot-workbench-remove"
          @click.stop="handleRemove"
        />
      </VCardTitle>

      <VCardText class="pa-3 chatbot-workbench-body">
        <VLabel class="text-body-2 mb-1">{{
          t('chatbot_tag_type_label')
        }}</VLabel>
        <VSelect
          v-model="tagData.tagType"
          :items="[
            { value: 'chat', title: t('chatbot_tag_type_chat') },
            { value: 'contact', title: t('chatbot_tag_type_contact') },
          ]"
          variant="outlined"
          density="compact"
          class="mb-3"
          :rules="[(v) => !!v || t('chatbot_tag_type_required')]"
          hide-details="auto"
        />

        <div v-if="tagData.tagType" class="mb-3">
          <VLabel class="text-body-2 mb-1">{{ t('chatbot_tag_label') }}</VLabel>
          <AppSelectSearch
            v-model="tagData.selectedTag"
            :items="tags"
            :placeholder="t('chatbot_tag_search_placeholder')"
            :loading="isLoadingTags"
            :clearable="true"
            multiple
            chips
            closable-chips
            item-value="value"
            item-title="title"
            class="label-select"
          >
            <template #chip="{ item }">
              <div class="d-flex align-center gap-1">
                <div
                  v-if="item && item.color"
                  class="label-color-circle"
                  :style="{ backgroundColor: item.color }"
                />
                <span>{{ item?.title }}</span>
              </div>
            </template>
            <template #prepend-inner="{ item }">
              <div
                v-if="item && !Array.isArray(item) && (item as any).color"
                class="label-color-circle me-2"
                :style="{ backgroundColor: (item as any).color }"
              />
            </template>
            <template #item-prepend="{ item }">
              <div
                v-if="item && (item as any).color"
                class="label-color-circle"
                :style="{ backgroundColor: (item as any).color }"
              />
            </template>
          </AppSelectSearch>
        </div>
      </VCardText>
    </VCard>
  </div>
</template>

<style scoped>
.chatbot-tag-node {
  min-width: 350px;
}

.tag-card {
  border-radius: 8px;
}

.node-drag-handle {
  cursor: grab;
  user-select: none;
}

.node-drag-handle:active {
  cursor: grabbing;
}

.cursor-pointer {
  cursor: pointer;
}

.max-height-300 {
  max-height: 300px;
  overflow-y: auto;
}

.label-select {
  .v-field__input {
    > .v-select__selection {
      margin: 0;
      display: flex;
      align-items: center;

      > span:not(.label-color-circle):not(:has(.label-color-circle)),
      > .v-select__selection-text {
        display: none !important;
      }
    }
  }

  .v-select__selection {
    .v-select__selection-text {
      display: none !important;
    }

    > span:not(:has(.label-color-circle)):not(.label-color-circle) {
      display: none !important;
    }
  }

  .v-list-item__prepend {
    margin-inline-end: 12px;
  }
}

.label-color-circle {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  flex-shrink: 0;
  margin-inline-end: 8px;
}
</style>
