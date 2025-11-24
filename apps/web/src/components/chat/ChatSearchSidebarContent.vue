<script lang="ts" setup>
import { useChatStore } from '@/@webcore/stores/chat';
import { computed } from 'vue';

defineEmits<{
  close: [];
}>();

const chatStore = useChatStore();
const { t } = useI18n();

const searchQuery = ref('');

const contactName = computed(() => {
  return (
    chatStore.activeChat?.contact?.name ?? chatStore.activeChat?.name ?? ''
  );
});

const searchMessageText = computed(() => {
  return t('search_messages_with', { name: contactName.value });
});
</script>

<template>
  <div class="chat-search-sidebar-content">
    <div class="d-flex align-center pa-4 border-b">
      <IconBtn class="me-2" @click="$emit('close')">
        <VIcon icon="tabler-x" />
      </IconBtn>
      <h6 class="text-h6">{{ $t('search_messages') }}</h6>
    </div>

    <div class="pa-4">
      <AppTextField
        v-model="searchQuery"
        :placeholder="$t('search_messages_placeholder')"
        prepend-inner-icon="tabler-search"
        class="mb-4"
      />

      <p class="text-body-2 text-medium-emphasis">
        {{ searchMessageText }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.chat-search-sidebar-content {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.border-b {
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
</style>
