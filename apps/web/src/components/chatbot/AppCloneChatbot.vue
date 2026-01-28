<script lang="ts" setup>
import { ref, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useChatbotStore } from '@/@webcore/stores/chatbot';
import { requiredValidator } from '@/@webcore/utils/validators';
import { VForm } from 'vuetify/components/VForm';
import DialogCloseBtn from '@/@webcore/components/DialogCloseBtn.vue';

const chatbotStore = useChatbotStore();
const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
  chatbotId: string | null;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', visible: boolean): void;
  (e: 'cloned'): void;
}>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const chatbotName = ref('');
const isCloning = ref(false);
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

const handleCloneChatbot = async () => {
  const validateForm = await refForm.value?.validate();
  if (!validateForm?.valid) {
    return;
  }

  if (!props.chatbotId) {
    return;
  }

  isCloning.value = true;
  try {
    const result = await chatbotStore.cloneChatbot({
      chatbot_id: props.chatbotId,
      name: chatbotName.value.trim(),
    });

    if (result) {
      isVisible.value = false;
      emit('cloned');
      await chatbotStore.listChatbots();
    }
  } finally {
    isCloning.value = false;
  }
};
</script>

<template>
  <VDialog v-model="isVisible" max-width="500" persistent>
    <DialogCloseBtn :disabled="isCloning" @click="isVisible = false" />

    <VOverlay
      :model-value="isCloning"
      class="align-center justify-center"
      contained
    >
      <VProgressCircular color="primary" indeterminate size="64" />
    </VOverlay>

    <VCard :title="$t('clone') + ' ' + $t('chatbot')">
      <VDivider />
      <VCardText class="pa-4">
        <VForm ref="refForm" @submit.prevent="handleCloneChatbot">
          <VLabel class="text-body-2 mb-1">{{ $t('name') }}:</VLabel>
          <AppTextField
            v-model="chatbotName"
            :placeholder="$t('chatbot_name_placeholder')"
            :rules="nameRules"
            :disabled="isCloning"
            autofocus
            class="mb-4"
          />
        </VForm>
      </VCardText>
      <VCardText class="d-flex justify-end flex-wrap gap-3">
        <VBtn
          variant="tonal"
          color="secondary"
          @click="isVisible = false"
          :disabled="isCloning"
        >
          {{ $t('cancel') }}
        </VBtn>
        <VBtn color="primary" :loading="isCloning" @click="handleCloneChatbot">
          {{ $t('clone') }}
        </VBtn>
      </VCardText>
    </VCard>
  </VDialog>
</template>
