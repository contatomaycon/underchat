<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import type { NodeProps } from '@vue-flow/core';
import { Handle, Position } from '@vue-flow/core';
import { useChatbotStore } from '@/@webcore/stores/chatbot';
import { useI18n } from 'vue-i18n';

interface TagData {
  tagType: 'chat' | 'contact' | null;
  selectedTag: string | null;
  onRemove?: () => void;
}

const props = defineProps<NodeProps>();
const chatbotStore = useChatbotStore();
const { t } = useI18n();

const getInitialData = (): TagData => {
  const data = props.data as TagData | undefined;
  return {
    tagType: data?.tagType || null,
    selectedTag: data?.selectedTag || null,
  };
};

const tagData = ref<TagData>(getInitialData());

const tags = ref<Array<{ value: string; title: string; color: string | null }>>(
  []
);
const isLoadingTags = ref(false);

const selectedTagTitle = computed(() => {
  const current = tags.value.find((t) => t.value === tagData.value.selectedTag);
  return current?.title || '';
});

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

    if (
      tagData.value.selectedTag &&
      !tags.value.some((t) => t.value === tagData.value.selectedTag)
    ) {
      tags.value.unshift({
        value: tagData.value.selectedTag,
        title: tagData.value.selectedTag,
        color: null,
      });
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
      tagData.value.selectedTag = null;
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
  <div class="chatbot-tag-node">
    <Handle type="target" :position="Position.Top" class="handle-target" />
    <Handle type="source" :position="Position.Bottom" class="handle-source" />

    <VCard class="tag-card" elevation="2">
      <VCardTitle
        class="d-flex align-center justify-space-between pa-2 node-drag-handle"
      >
        <div class="d-flex align-center ga-2">
          <VIcon icon="tabler-tag" color="secondary" size="20" />
          <span class="text-sm font-weight-medium">{{
            t('chatbot_tag_node_title')
          }}</span>
        </div>
        <VIcon
          v-if="(props.data as TagData)?.onRemove"
          icon="tabler-x"
          size="18"
          color="error"
          class="cursor-pointer"
          @click.stop="handleRemove"
        />
      </VCardTitle>

      <VCardText class="pa-3">
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
            item-value="value"
            item-title="title"
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
</style>
