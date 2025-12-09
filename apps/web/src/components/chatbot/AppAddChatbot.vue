<script lang="ts" setup>
import { ref, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useChatbotStore } from '@/@webcore/stores/chatbot';
import { requiredValidator } from '@/@webcore/utils/validators';
import { VForm } from 'vuetify/components/VForm';

const chatbotStore = useChatbotStore();
const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', visible: boolean): void;
  (e: 'created'): void;
}>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const chatbotName = ref('');
const isCreating = ref(false);
const refForm = ref<VForm>();

const nameRules = computed(() => [
  requiredValidator(chatbotName.value, t('name_required')),
  () => {
    const nameExists = chatbotStore.list.some(
      (chatbot) =>
        chatbot.name.toLowerCase().trim() ===
        chatbotName.value.toLowerCase().trim()
    );
    if (nameExists) {
      return t('chatbot_name_already_exists');
    }
    return true;
  },
]);

watch(isVisible, (newValue) => {
  if (newValue) {
    chatbotName.value = '';
    refForm.value?.resetValidation();
  }
});

const handleCreateChatbot = async () => {
  const validateForm = await refForm.value?.validate();
  if (!validateForm?.valid) return;

  isCreating.value = true;
  try {
    const result = await chatbotStore.createChatbot({
      name: chatbotName.value.trim(),
    });

    if (result) {
      isVisible.value = false;
      emit('created');
      await chatbotStore.listChatbots();
    }
  } finally {
    isCreating.value = false;
  }
};
</script>

<template>
  <VDialog v-model="isVisible" max-width="500" persistent>
    <VOverlay
      :model-value="isCreating"
      class="align-center justify-center"
      contained
    >
      <VProgressCircular color="primary" indeterminate size="64" />
    </VOverlay>

    <VCard>
      <VCardTitle class="d-flex align-center justify-space-between pa-4">
        <span>{{ $t('add') }} {{ $t('chatbot') }}</span>
        <VBtn
          icon
          size="small"
          variant="text"
          @click="isVisible = false"
          :disabled="isCreating"
        >
          <VIcon icon="tabler-x" />
        </VBtn>
      </VCardTitle>
      <VDivider />
      <VCardText class="pa-4">
        <VForm ref="refForm" @submit.prevent="handleCreateChatbot">
          <VLabel class="text-body-2 mb-1">{{ $t('name') }}:</VLabel>
          <AppTextField
            v-model="chatbotName"
            :placeholder="$t('chatbot_name_placeholder')"
            :rules="nameRules"
            :disabled="isCreating"
            autofocus
          />
        </VForm>
      </VCardText>
      <VCardText class="d-flex justify-end flex-wrap gap-3">
        <VBtn
          variant="tonal"
          color="secondary"
          @click="isVisible = false"
          :disabled="isCreating"
        >
          {{ $t('cancel') }}
        </VBtn>
        <VBtn
          color="primary"
          :loading="isCreating"
          @click="handleCreateChatbot"
        >
          {{ $t('add') }}
        </VBtn>
      </VCardText>
    </VCard>
  </VDialog>
</template>
