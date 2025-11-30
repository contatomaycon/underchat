<script setup lang="ts">
import { ref, computed, watch } from 'vue';
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
const tagSearch = ref('');
const isLoadingTags = ref(false);
const isTagMenuOpen = ref(false);

const filteredTags = computed(() => {
  if (!tagSearch.value) {
    return tags.value;
  }
  const query = tagSearch.value.toLowerCase();
  return tags.value.filter((tag) => tag?.title?.toLowerCase().includes(query));
});

const updateNodeData = () => {
  if (props.data) {
    const data = props.data as TagData;
    data.tagType = tagData.value.tagType;
    data.selectedTag = tagData.value.selectedTag;
  }
};

const loadTags = async () => {
  isLoadingTags.value = true;
  try {
    const tagsList = await chatbotStore.listChatbotTags();

    tags.value = tagsList.map((tag) => ({
      value: tag.label_template_id,
      title: tag.label,
      color: tag.color || null,
    }));
  } catch (error) {
    console.error('Error loading tags:', error);
    tags.value = [];
  } finally {
    isLoadingTags.value = false;
  }
};

watch(isTagMenuOpen, (isOpen) => {
  if (isOpen) {
    loadTags();
  } else {
    tagSearch.value = '';
  }
});

watch(
  () => tagData.value.tagType,
  (newType) => {
    if (!newType) {
      tagData.value.selectedTag = null;
      tags.value = [];
      tagSearch.value = '';
      isTagMenuOpen.value = false;
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
    <Handle type="target" :position="Position.Top" />
    <Handle type="source" :position="Position.Bottom" />

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
        <VSelect
          v-model="tagData.tagType"
          :items="[
            { value: 'chat', title: t('chatbot_tag_type_chat') },
            { value: 'contact', title: t('chatbot_tag_type_contact') },
          ]"
          :label="t('chatbot_tag_type_label')"
          variant="outlined"
          density="compact"
          class="mb-3"
          :rules="[(v) => !!v || t('chatbot_tag_type_required')]"
          hide-details="auto"
        />

        <div v-if="tagData.tagType" class="mb-3">
          <VLabel class="mb-1 text-body-2"
            >{{ t('chatbot_tag_label') }}
            <span class="text-error">*</span></VLabel
          >
          <VMenu v-model="isTagMenuOpen">
            <template #activator="{ props: menuProps }">
              <VTextField
                v-bind="menuProps"
                :model-value="
                  tags.find((t) => t.value === tagData.selectedTag)?.title || ''
                "
                :placeholder="t('chatbot_tag_search_placeholder')"
                variant="outlined"
                readonly
                append-inner-icon="tabler-chevron-down"
                :loading="isLoadingTags"
                density="compact"
                :error="!tagData.selectedTag"
                :error-messages="
                  !tagData.selectedTag ? [t('chatbot_tag_required')] : []
                "
                hide-details="auto"
              />
            </template>
            <VCard>
              <VCardText>
                <VTextField
                  v-model="tagSearch"
                  :placeholder="t('chatbot_tag_search_label_placeholder')"
                  variant="outlined"
                  density="compact"
                  prepend-inner-icon="tabler-search"
                  hide-details
                />
              </VCardText>
              <VDivider />
              <VList density="compact" class="max-height-300">
                <VListItem
                  v-for="tag in filteredTags"
                  :key="tag.value"
                  :value="tag.value"
                  @click="
                    tagData.selectedTag = tag.value;
                    isTagMenuOpen = false;
                  "
                >
                  <template #prepend>
                    <VAvatar
                      size="24"
                      :style="{
                        backgroundColor: tag.color || '#1976D2',
                      }"
                    />
                  </template>
                  <VListItemTitle>{{ tag.title }}</VListItemTitle>
                </VListItem>
                <VListItem
                  v-if="filteredTags.length === 0 && !isLoadingTags"
                  disabled
                >
                  <VListItemTitle
                    class="text-center text-body-2 text-medium-emphasis"
                  >
                    {{ t('chatbot_tag_no_results') }}
                  </VListItemTitle>
                </VListItem>
              </VList>
            </VCard>
          </VMenu>
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
