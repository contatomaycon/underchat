<script lang="ts" setup>
import VDialogHandler from '@/components/VDialogHandler.vue';

type SecurityKeyConfig = {
  enabled: boolean;
  chatbot: boolean;
  schedule: boolean;
  quick_message: boolean;
};

type SecurityKeyScope = Exclude<keyof SecurityKeyConfig, 'enabled'>;

const props = defineProps<{
  modelValue: boolean;
  config: SecurityKeyConfig;
  saving?: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', visible: boolean): void;
  (e: 'save', config: SecurityKeyConfig): void;
}>();

const { t } = useI18n();

const isVisible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});

const localConfig = reactive<Omit<SecurityKeyConfig, 'enabled'>>({
  chatbot: true,
  schedule: true,
  quick_message: true,
});
const scopeDisableConfirmOpen = ref(false);
const pendingScopeDisable = ref<SecurityKeyScope | null>(null);

const scopeOptions = computed<
  Array<{
    key: SecurityKeyScope;
    label: string;
  }>
>(() => [
  {
    key: 'chatbot',
    label: t('security_key_chatbot_label'),
  },
  {
    key: 'schedule',
    label: t('security_key_schedule_label'),
  },
  {
    key: 'quick_message',
    label: t('security_key_quick_message_label'),
  },
]);

const hasActiveOption = computed(
  () => localConfig.chatbot || localConfig.schedule || localConfig.quick_message
);

watch(
  () => props.config,
  (config) => {
    localConfig.chatbot = config.chatbot;
    localConfig.schedule = config.schedule;
    localConfig.quick_message = config.quick_message;
  },
  { deep: true, immediate: true }
);

const requestScopeToggle = (scope: SecurityKeyScope, nextValue: boolean) => {
  if (!nextValue && localConfig[scope]) {
    pendingScopeDisable.value = scope;
    scopeDisableConfirmOpen.value = true;
    return;
  }

  localConfig[scope] = nextValue;
};

const confirmScopeDisable = () => {
  if (!pendingScopeDisable.value) {
    return;
  }

  localConfig[pendingScopeDisable.value] = false;
  pendingScopeDisable.value = null;
};

const cancelScopeDisable = () => {
  pendingScopeDisable.value = null;
};

const save = () => {
  emit('save', {
    enabled: props.config.enabled && hasActiveOption.value,
    chatbot: localConfig.chatbot,
    schedule: localConfig.schedule,
    quick_message: localConfig.quick_message,
  });
};
</script>

<template>
  <VDialog v-model="isVisible" max-width="520" persistent>
    <VCard>
      <VCardTitle class="d-flex justify-space-between align-center">
        <span>{{ $t('security_key_config_title') }}</span>
        <IconBtn :disabled="saving" @click="isVisible = false">
          <VIcon icon="tabler-x" />
        </IconBtn>
      </VCardTitle>

      <VCardText class="d-flex flex-column gap-4">
        <VAlert type="warning" variant="tonal" density="comfortable">
          {{ $t('security_key_warning_message') }}
        </VAlert>

        <div class="security-key-options">
          <div
            v-for="option in scopeOptions"
            :key="option.key"
            class="security-key-option"
          >
            <div class="d-flex align-center gap-3">
              <VIcon icon="tabler-shield-check" size="22" color="primary" />
              <span class="text-body-1 font-weight-medium">
                {{ option.label }}
              </span>
            </div>

            <VSwitch
              :model-value="localConfig[option.key]"
              color="primary"
              density="comfortable"
              :disabled="saving"
              hide-details
              @update:model-value="
                requestScopeToggle(option.key, Boolean($event))
              "
            />
          </div>
        </div>
      </VCardText>

      <VCardText class="d-flex justify-end flex-wrap gap-3">
        <VBtn
          variant="tonal"
          color="secondary"
          :disabled="saving"
          @click="isVisible = false"
        >
          {{ $t('close') }}
        </VBtn>
        <VBtn
          color="primary"
          :loading="saving"
          :disabled="saving"
          @click="save"
        >
          {{ $t('save') }}
        </VBtn>
      </VCardText>
    </VCard>
  </VDialog>

  <VDialogHandler
    v-model="scopeDisableConfirmOpen"
    :title="$t('security_key_scope_disable_title')"
    :message="$t('security_key_scope_disable_confirmation')"
    :confirm-text="$t('confirm')"
    :cancel-text="$t('cancel')"
    @confirm="confirmScopeDisable"
    @cancel="cancelScopeDisable"
  />
</template>

<style scoped>
.security-key-options {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
  overflow: hidden;
}

.security-key-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 64px;
  padding: 12px 16px;
}

.security-key-option + .security-key-option {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
</style>
