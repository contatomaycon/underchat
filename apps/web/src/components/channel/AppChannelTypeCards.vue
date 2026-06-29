<script setup lang="ts">
import { computed } from 'vue';
import { EWorkerType } from '@core/common/enums/EWorkerType';

interface ChannelTypeCard {
  type: EWorkerType;
  title: string;
  description: string;
  icon: string;
  tone: 'official' | 'socket' | 'browser';
  featured?: boolean;
}

const model = defineModel<EWorkerType | null>({ default: null });
const { t } = useI18n();

const props = withDefaults(
  defineProps<{
    allowOfficial?: boolean;
    lockOfficial?: boolean;
    disabledTypes?: EWorkerType[];
  }>(),
  {
    allowOfficial: true,
    lockOfficial: false,
    disabledTypes: () => [],
  }
);

const cards = computed<ChannelTypeCard[]>(() => [
  {
    type: EWorkerType.whatsapp,
    title: t('whatsapp_official'),
    description: t('whatsapp_official_description'),
    icon: 'mdi-whatsapp',
    tone: 'official',
    featured: true,
  },
  {
    type: EWorkerType.baileys,
    title: t('unofficial_socket'),
    description: t('channel_option_socket_description'),
    icon: 'tabler-plug-connected',
    tone: 'socket',
  },
  {
    type: EWorkerType.wwebjs,
    title: t('unofficial_browser'),
    description: t('channel_option_browser_description'),
    icon: 'tabler-browser',
    tone: 'browser',
  },
  {
    type: EWorkerType.whatsmeow,
    title: t('unofficial_whatsmeow'),
    description: t('channel_option_socket_stable_description'),
    icon: 'tabler-bolt',
    tone: 'socket',
  },
]);

const visibleCards = computed(() =>
  props.allowOfficial
    ? cards.value
    : cards.value.filter((card) => card.type !== EWorkerType.whatsapp)
);

const isDisabled = (card: ChannelTypeCard) =>
  props.disabledTypes.includes(card.type) ||
  (props.lockOfficial && card.type !== EWorkerType.whatsapp);

const selectCard = (card: ChannelTypeCard) => {
  if (isDisabled(card)) {
    return;
  }

  model.value = card.type;
};
</script>

<template>
  <div class="channel-type-cards">
    <button
      v-for="card in visibleCards"
      :key="card.type"
      type="button"
      class="channel-type-card"
      :class="[
        `channel-type-card--${card.tone}`,
        {
          'channel-type-card--featured': card.featured,
          'channel-type-card--selected': model === card.type,
          'channel-type-card--disabled': isDisabled(card),
        },
      ]"
      :disabled="isDisabled(card)"
      @click="selectCard(card)"
    >
      <span class="channel-type-card__icon">
        <VIcon :icon="card.icon" size="28" />
      </span>
      <span class="channel-type-card__body">
        <span class="channel-type-card__title">{{ card.title }}</span>
        <span class="channel-type-card__description">
          {{ card.description }}
        </span>
      </span>
      <span v-if="model === card.type" class="channel-type-card__check">
        <VIcon icon="tabler-check" size="18" />
      </span>
    </button>
  </div>
</template>

<style scoped>
.channel-type-cards {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.channel-type-card {
  position: relative;
  display: flex;
  min-block-size: 124px;
  align-items: flex-start;
  gap: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 8px;
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
  cursor: pointer;
  inline-size: 100%;
  padding: 16px;
  text-align: start;
  transition:
    border-color 160ms ease,
    box-shadow 160ms ease,
    transform 160ms ease,
    background-color 160ms ease;
}

.channel-type-card:hover {
  border-color: rgba(var(--v-theme-primary), 0.42);
  box-shadow: 0 10px 28px rgba(var(--v-theme-on-surface), 0.08);
  transform: translateY(-1px);
}

.channel-type-card--featured {
  grid-column: 1 / -1;
  min-block-size: 118px;
  background:
    linear-gradient(
      135deg,
      rgba(37, 211, 102, 0.14),
      rgba(var(--v-theme-surface), 1) 54%
    ),
    rgb(var(--v-theme-surface));
}

.channel-type-card--selected {
  border-color: rgb(var(--v-theme-primary));
  box-shadow: 0 0 0 3px rgba(var(--v-theme-primary), 0.14);
}

.channel-type-card--disabled {
  cursor: not-allowed;
  opacity: 0.52;
  transform: none;
}

.channel-type-card__icon {
  display: inline-grid;
  flex: 0 0 44px;
  place-items: center;
  border-radius: 8px;
  block-size: 44px;
  inline-size: 44px;
}

.channel-type-card--official .channel-type-card__icon {
  background: #25d366;
  color: white;
}

.channel-type-card--socket .channel-type-card__icon {
  background: rgba(var(--v-theme-info), 0.14);
  color: rgb(var(--v-theme-info));
}

.channel-type-card--browser .channel-type-card__icon {
  background: rgba(var(--v-theme-warning), 0.14);
  color: rgb(var(--v-theme-warning));
}

.channel-type-card__body {
  display: flex;
  min-inline-size: 0;
  flex-direction: column;
  gap: 6px;
}

.channel-type-card__title {
  font-size: 0.95rem;
  font-weight: 700;
  line-height: 1.25;
}

.channel-type-card__description {
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.82rem;
  line-height: 1.45;
}

.channel-type-card__check {
  position: absolute;
  display: inline-grid;
  place-items: center;
  border-radius: 999px;
  background: rgb(var(--v-theme-primary));
  block-size: 24px;
  color: rgb(var(--v-theme-on-primary));
  inline-size: 24px;
  inset-block-start: 12px;
  inset-inline-end: 12px;
}

@media (max-width: 720px) {
  .channel-type-cards {
    grid-template-columns: 1fr;
  }

  .channel-type-card--featured {
    grid-column: auto;
  }
}
</style>
