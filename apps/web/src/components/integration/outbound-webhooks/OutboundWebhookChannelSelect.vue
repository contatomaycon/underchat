<script setup lang="ts">
import { computed, watch } from 'vue';
import AppSelectSearch from '@/components/AppSelectSearch.vue';
import type { OutboundWebhookChannel } from '@/types/outboundWebhooks';

interface Props {
  channels: readonly OutboundWebhookChannel[];
  currentChannel: OutboundWebhookChannel | null;
  disabled: boolean;
  showValidation: boolean;
  isLoading: boolean;
  hasLoaded: boolean;
  loadError: string | null;
}

interface Emits {
  validityChange: [valid: boolean];
  retry: [];
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();
const channelId = defineModel<string | null>({ required: true });

const availableOptions = computed(() => {
  const options = [...props.channels];
  const current = props.currentChannel;
  const canUseCurrentFallback =
    current?.available && (!props.hasLoaded || Boolean(props.loadError));

  if (
    canUseCurrentFallback &&
    !options.some((channel) => channel.id === current.id)
  ) {
    options.unshift(current);
  }

  return options.map((channel) => ({
    ...channel,
    title: channel.number
      ? `${channel.name} · ${channel.number}`
      : channel.name,
  }));
});

const selectedChannel = computed(
  () =>
    availableOptions.value.find((channel) => channel.id === channelId.value) ??
    null
);
const isCurrentChannelUnavailable = computed(() => {
  if (!props.currentChannel || channelId.value !== props.currentChannel.id) {
    return false;
  }
  if (!props.currentChannel.available) return true;
  return (
    props.hasLoaded &&
    !props.loadError &&
    !props.channels.some((channel) => channel.id === props.currentChannel?.id)
  );
});
const isEmpty = computed(
  () => props.hasLoaded && !props.loadError && props.channels.length === 0
);
const hasValidationError = computed(
  () => props.showValidation && !selectedChannel.value
);

watch(selectedChannel, (channel) => emit('validityChange', Boolean(channel)), {
  immediate: true,
});
</script>

<template>
  <div class="channel-select">
    <AppSelectSearch
      v-model="channelId"
      :items="availableOptions"
      item-value="id"
      item-title="title"
      :label="$t('outbound_webhook_channel_label')"
      :placeholder="$t('outbound_webhook_channel_placeholder')"
      :disabled="
        props.disabled || props.isLoading || Boolean(props.loadError) || isEmpty
      "
      :loading="props.isLoading"
      no-items-text="outbound_webhook_channel_empty_title"
      :clearable="true"
      option-test-id-prefix="outbound-webhook-channel-option"
      data-testid="outbound-webhook-channel"
    >
      <template #selection="{ item }">
        <div class="channel-select__selection">
          <VIcon
            class="channel-select__selection-icon"
            icon="tabler-brand-whatsapp"
            size="18"
            color="primary"
          />
          <div class="channel-select__selection-text">
            <strong>{{ item.name }}</strong>
            <span v-if="item.number">{{ item.number }}</span>
          </div>
        </div>
      </template>
      <template #item-title="{ item }">
        <div class="channel-select__option">
          <VIcon
            class="channel-select__option-icon"
            icon="tabler-brand-whatsapp"
            size="17"
            color="primary"
            aria-hidden="true"
          />
          <div class="channel-select__option-text">
            <strong>{{ item.name }}</strong>
            <span v-if="item.number">{{ item.number }}</span>
          </div>
        </div>
      </template>
    </AppSelectSearch>

    <VAlert
      v-if="props.loadError"
      class="channel-select__state"
      color="error"
      variant="tonal"
      density="compact"
      icon="tabler-cloud-off"
    >
      <div class="channel-select__state-content">
        <span>{{ props.loadError }}</span>
        <VBtn
          size="small"
          variant="text"
          prepend-icon="tabler-refresh"
          :disabled="props.disabled || props.isLoading"
          @click="emit('retry')"
        >
          {{ $t('outbound_webhook_try_again') }}
        </VBtn>
      </div>
    </VAlert>

    <VAlert
      v-else-if="isCurrentChannelUnavailable"
      class="channel-select__state"
      color="warning"
      variant="tonal"
      density="compact"
      icon="tabler-alert-triangle"
    >
      <strong>{{ $t('outbound_webhook_channel_unavailable_title') }}</strong>
      <p>
        {{
          $t('outbound_webhook_channel_unavailable_description', {
            channel: props.currentChannel?.name,
          })
        }}
      </p>
    </VAlert>

    <VAlert
      v-else-if="isEmpty"
      class="channel-select__state"
      color="info"
      variant="tonal"
      density="compact"
      icon="tabler-plug-off"
    >
      <strong>{{ $t('outbound_webhook_channel_empty_title') }}</strong>
      <p>{{ $t('outbound_webhook_channel_empty_description') }}</p>
    </VAlert>

    <p v-if="hasValidationError" class="channel-select__error" role="alert">
      {{ $t('outbound_webhook_channel_required') }}
    </p>

    <p v-else class="channel-select__hint">
      <VIcon icon="tabler-route" size="15" />
      {{ $t('outbound_webhook_channel_scope_hint') }}
    </p>
  </div>
</template>

<style scoped lang="scss">
.channel-select {
  display: grid;
  gap: 0.65rem;
}

.channel-select__selection,
.channel-select__option {
  display: flex;
  overflow: hidden;
  align-items: center;
  gap: 0.65rem;
  min-inline-size: 0;
}

.channel-select__selection-icon,
.channel-select__option-icon {
  flex: 0 0 auto;
}

.channel-select__selection-text,
.channel-select__option-text {
  display: flex;
  overflow: hidden;
  align-items: baseline;
  gap: 0.45rem;
  min-inline-size: 0;
}

.channel-select__selection-text strong,
.channel-select__option-text strong {
  overflow: hidden;
  color: rgb(var(--v-theme-on-surface), 0.84);
  font-size: 0.78rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.channel-select__selection-text span,
.channel-select__option-text span {
  overflow: hidden;
  color: rgb(var(--v-theme-on-surface), 0.5);
  font-size: 0.7rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.channel-select__state-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  inline-size: 100%;
}

.channel-select__state p {
  margin-block: 0.2rem 0;
  margin-inline: 0;
  font-size: 0.75rem;
}

.channel-select__error,
.channel-select__hint {
  display: flex;
  align-items: center;
  margin: 0;
  font-size: 0.73rem;
  gap: 0.35rem;
}

.channel-select__error {
  color: rgb(var(--v-theme-error));
}

.channel-select__hint {
  color: rgb(var(--v-theme-on-surface), 0.52);
}

@media (max-width: 599px) {
  .channel-select__state-content {
    align-items: stretch;
    flex-direction: column;
  }

  .channel-select__state-content :deep(.v-btn) {
    inline-size: 100%;
  }
}
</style>
