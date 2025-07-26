<script lang="ts" setup>
import { onMessage } from '@/@webcore/centrifugo';
import { ECentrifugoChannel } from '@core/common/enums/ECentrifugoChannel';
import { formatDateTime } from '@core/common/functions/formatDateTime';
import { IServerSshCentrifugo } from '@core/common/interfaces/IServerSshCentrifugo';

const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
  serverId: number | null;
}>();

const emit = defineEmits<(e: 'update:modelValue', visible: boolean) => void>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const serverId = toRef(props, 'serverId');

const items = ref([
  {
    command: t('installation_pending'),
    output: t('installation_pending'),
    date: formatDateTime(new Date()),
  },
]);

const listContainer = ref<HTMLElement | null>(null);
const isUserScrolling = ref(false);
const threshold = ref(20);
const autoScrollIdle = ref(5000);
const maxRecords = ref(200);

let scrollTimer: number | null = null;
let lastInteraction = Date.now();
let idleInterval: number | null = null;

const handleScroll = () => {
  isUserScrolling.value = true;

  lastInteraction = Date.now();

  if (scrollTimer) {
    clearTimeout(scrollTimer);
  }

  scrollTimer = window.setTimeout(() => (isUserScrolling.value = false), 150);
};

const atBottom = () => {
  if (!listContainer.value) {
    return true;
  }

  const el = listContainer.value;

  return el.scrollHeight - el.scrollTop - el.clientHeight < threshold.value;
};

const scrollToBottom = () => {
  if (!listContainer.value) return;

  nextTick(() => {
    const el = listContainer.value;
    if (!el) return;

    el.scrollTop = el.scrollHeight;
  });
};

const scrollIfNeeded = () => {
  if (!listContainer.value) return;

  if (!isUserScrolling.value && atBottom()) {
    scrollToBottom();
  }
};

onMounted(() => {
  nextTick(() => {
    if (listContainer.value)
      listContainer.value.addEventListener('scroll', handleScroll, {
        passive: true,
      });

    scrollIfNeeded();
  });

  idleInterval = window.setInterval(() => {
    if (Date.now() - lastInteraction >= autoScrollIdle.value) scrollToBottom();
  }, 1000);

  onMessage(ECentrifugoChannel.server_ssh, (data: IServerSshCentrifugo) => {
    if (data.server_id !== serverId.value) return;

    items.value.push({
      command: data.command,
      output: data.output,
      date: formatDateTime(data.date),
    });

    if (items.value.length > maxRecords.value) {
      items.value.splice(0, items.value.length - maxRecords.value);
    }

    scrollIfNeeded();
  });
});

onBeforeUnmount(() => {
  if (listContainer.value) {
    listContainer.value.removeEventListener('scroll', handleScroll);
  }

  if (scrollTimer) {
    clearTimeout(scrollTimer);
  }

  if (idleInterval) {
    clearInterval(idleInterval);
  }
});
</script>

<template>
  <VDialog v-model="isVisible" max-width="600">
    <DialogCloseBtn @click="isVisible = false" />

    <VCard :title="$t('console_installation')">
      <VCardText>
        <div
          ref="listContainer"
          class="app-bar-search-list py-0"
          style="max-height: 60vh; overflow-y: auto"
        >
          <VList v-show="items.length" density="compact">
            <template v-for="item in items" :key="item">
              <slot :item="item">
                <VListItem>
                  <VListItemTitle class="wrap-text">
                    <strong>{{ item.date }}:</strong>
                    {{ item.command }}
                  </VListItemTitle>
                  <VListItemSubtitle class="wrap-text">
                    {{ item.output }}
                  </VListItemSubtitle>
                </VListItem>
              </slot>
            </template>
          </VList>
        </div>
      </VCardText>

      <VCardText class="d-flex justify-end flex-wrap gap-3">
        <VBtn variant="tonal" color="secondary" @click="isVisible = false">
          {{ $t('close') }}
        </VBtn>
      </VCardText>
    </VCard>
  </VDialog>
</template>

<style scoped>
.wrap-text {
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
