<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

type ProtocolType = 'A' | 'T' | 'U';

type ProtocolWithType = {
  protocol: string;
  type: ProtocolType;
};

type ChatProtocolSource = {
  chat_id?: string;
  protocol_start?: string[] | null;
  protocol_transfer?: string[] | null;
  protocol_ura?: string[] | null;
};

const props = defineProps<{
  chat?: ChatProtocolSource | null;
  contactName?: string | null;
}>();

const emit = defineEmits<{
  copied: [];
  'copy-error': [message?: string];
}>();

const { t } = useI18n();

const isProtocolsDialogOpen = ref(false);

const normalizedContactName = computed(() => {
  return props.contactName?.trim() ?? '';
});

const protocolsWithType = computed<ProtocolWithType[]>(() => {
  const uniqueProtocols = new Map<string, ProtocolType>();

  const appendProtocols = (
    protocols: string[] | null | undefined,
    type: ProtocolType
  ) => {
    if (!Array.isArray(protocols) || protocols.length === 0) return;

    for (const protocol of protocols) {
      if (!protocol || uniqueProtocols.has(protocol)) continue;
      uniqueProtocols.set(protocol, type);
    }
  };

  appendProtocols(props.chat?.protocol_start, 'A');
  appendProtocols(props.chat?.protocol_transfer, 'T');
  appendProtocols(props.chat?.protocol_ura, 'U');

  return Array.from(uniqueProtocols.entries()).map(([protocol, type]) => ({
    protocol,
    type,
  }));
});

const primaryProtocol = computed<ProtocolWithType | null>(() => {
  if (protocolsWithType.value.length === 0) return null;
  return protocolsWithType.value[0];
});

const extraProtocolsCount = computed(() => {
  return Math.max(0, protocolsWithType.value.length - 1);
});

const showTrigger = computed(() => {
  return primaryProtocol.value !== null;
});

const getProtocolTypeColor = (
  type: ProtocolType
): 'info' | 'warning' | 'success' => {
  switch (type) {
    case 'T':
      return 'info';
    case 'U':
      return 'warning';
    case 'A':
      return 'success';
    default:
      return 'success';
  }
};

const openProtocolsDialog = () => {
  if (!showTrigger.value) return;
  isProtocolsDialogOpen.value = true;
};

const closeProtocolsDialog = () => {
  isProtocolsDialogOpen.value = false;
};

const copyToClipboard = async (protocol: string) => {
  try {
    await navigator.clipboard.writeText(protocol);
    emit('copied');
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : undefined;
    emit('copy-error', errorMessage);
  }
};

watch(
  () => props.chat?.chat_id,
  () => {
    closeProtocolsDialog();
  }
);

watch(showTrigger, (visible) => {
  if (!visible) {
    closeProtocolsDialog();
  }
});
</script>

<template>
  <div v-if="showTrigger" class="chat-protocol">
    <VBtn
      variant="tonal"
      color="primary"
      size="small"
      class="chat-protocol__trigger"
      :title="t('view_all_protocols')"
      @click="openProtocolsDialog"
    >
      <VIcon size="16" icon="tabler-file-text" class="me-1" />
      <span class="chat-protocol__prefix">{{ t('protocol') }}:</span>
      <span class="chat-protocol__value">
        {{ primaryProtocol?.protocol }}
      </span>
      <VChip
        v-if="extraProtocolsCount > 0"
        size="x-small"
        color="primary"
        variant="flat"
        class="chat-protocol__count"
      >
        +{{ extraProtocolsCount }}
      </VChip>
    </VBtn>

    <VDialog v-model="isProtocolsDialogOpen" max-width="520">
      <VCard>
        <VCardTitle class="d-flex align-center justify-space-between">
          <div>
            <div class="text-h6">{{ t('protocols') }}</div>
            <div
              v-if="normalizedContactName"
              class="text-caption text-medium-emphasis"
            >
              {{ normalizedContactName }}
            </div>
          </div>
          <IconBtn @click="closeProtocolsDialog">
            <VIcon>tabler-x</VIcon>
          </IconBtn>
        </VCardTitle>

        <VDivider />

        <VCardText>
          <VList class="py-0">
            <VListItem
              v-for="item in protocolsWithType"
              :key="`${item.type}-${item.protocol}`"
              class="px-0"
            >
              <template #prepend>
                <VIcon color="primary" class="me-2">tabler-file-text</VIcon>
              </template>

              <VListItemTitle class="flex-grow-1">
                <div class="d-flex align-center justify-space-between gap-2">
                  <div class="d-flex align-center gap-2 overflow-hidden">
                    <VChip
                      size="x-small"
                      :color="getProtocolTypeColor(item.type)"
                      variant="tonal"
                      class="font-weight-medium"
                    >
                      {{ item.type }}
                    </VChip>
                    <span class="chat-protocol-dialog__value">{{
                      item.protocol
                    }}</span>
                  </div>

                  <VBtn
                    icon
                    size="x-small"
                    variant="text"
                    class="flex-shrink-0"
                    :title="t('copy')"
                    @click="copyToClipboard(item.protocol)"
                  >
                    <VIcon size="16">tabler-copy</VIcon>
                  </VBtn>
                </div>
              </VListItemTitle>
            </VListItem>
          </VList>
        </VCardText>

        <VDivider />

        <VCardText class="pt-2">
          <div
            class="text-caption text-medium-emphasis d-flex flex-column gap-1"
          >
            <div class="d-flex align-center gap-2">
              <VChip
                size="x-small"
                color="info"
                variant="tonal"
                class="font-weight-medium"
              >
                T
              </VChip>
              <span> - {{ t('protocol_type_transfer') }}</span>
            </div>

            <div class="d-flex align-center gap-2">
              <VChip
                size="x-small"
                color="warning"
                variant="tonal"
                class="font-weight-medium"
              >
                U
              </VChip>
              <span> - {{ t('protocol_type_ura') }}</span>
            </div>

            <div class="d-flex align-center gap-2">
              <VChip
                size="x-small"
                color="success"
                variant="tonal"
                class="font-weight-medium"
              >
                A
              </VChip>
              <span> - {{ t('protocol_type_attendance') }}</span>
            </div>
          </div>
        </VCardText>

        <VDivider />

        <VCardActions class="pa-4">
          <VSpacer />
          <VBtn
            color="primary"
            variant="elevated"
            @click="closeProtocolsDialog"
          >
            {{ t('close') }}
          </VBtn>
        </VCardActions>
      </VCard>
    </VDialog>
  </div>
</template>

<style lang="scss" scoped>
.chat-protocol {
  display: flex;
  align-items: center;
  min-width: 0;
  margin-inline: 0.75rem;
}

.chat-protocol__trigger {
  max-width: 340px;
  min-width: 0;
  text-transform: none;
  letter-spacing: normal;
  gap: 0.375rem;
  padding-inline: 0.625rem;
}

.chat-protocol__prefix {
  font-size: 0.75rem;
  color: rgba(var(--v-theme-on-surface), 0.75);
  white-space: nowrap;
  margin-inline-end: 0.2rem;
}

.chat-protocol__value {
  font-weight: 600;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-protocol__count {
  margin-inline-start: 0.125rem;
  font-weight: 600;
}

.chat-protocol-dialog__value {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 960px) {
  .chat-protocol {
    margin-inline: 0.5rem;
  }

  .chat-protocol__trigger {
    max-width: 190px;
    padding-inline: 0.5rem;
  }

  .chat-protocol__prefix {
    display: none;
  }

  .chat-protocol__value {
    max-width: 100px;
    font-size: 0.75rem;
  }
}

@media (max-width: 600px) {
  .chat-protocol {
    margin-inline: 0.125rem;
    flex-shrink: 0;
  }

  .chat-protocol__trigger {
    max-width: 120px;
    padding-inline: 0.375rem;
    font-size: 0.6875rem;
  }

  .chat-protocol__value {
    max-width: 64px;
  }
}
</style>
