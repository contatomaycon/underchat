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
        <span v-if="card.featured" class="channel-type-card__badge">
          {{ $t('channel_type_official_badge') }}
        </span>
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
  gap: 14px;
}

.channel-type-card {
  position: relative;
  display: flex;
  min-block-size: 136px;
  align-items: flex-start;
  gap: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 17px;
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
  cursor: pointer;
  inline-size: 100%;
  padding: 18px;
  text-align: start;
  transition:
    border-color 160ms ease,
    box-shadow 160ms ease,
    transform 220ms ease,
    background-color 160ms ease;
}

.channel-type-card:hover {
  border-color: rgba(var(--v-theme-primary), 0.42);
  box-shadow: 0 18px 42px rgba(var(--v-theme-on-surface), 0.1);
  transform: translateY(-3px);
}

.channel-type-card--featured {
  grid-column: 1 / -1;
  min-block-size: 126px;
  background:
    linear-gradient(
      135deg,
      rgba(37, 211, 102, 0.16),
      rgba(var(--v-theme-surface), 1) 62%
    ),
    rgb(var(--v-theme-surface));
}

.channel-type-card--featured::before {
  position: absolute;
  border-radius: 999px;
  background: linear-gradient(90deg, #25d366, rgba(37, 211, 102, 0.24));
  block-size: 4px;
  content: '';
  inline-size: 104px;
  inset-block-start: 0;
  inset-inline-start: 18px;
}

.channel-type-card--selected {
  border-color: rgb(var(--v-theme-primary));
  background-color: rgba(var(--v-theme-primary), 0.025);
  box-shadow:
    0 0 0 4px rgba(var(--v-theme-primary), 0.11),
    0 16px 38px rgba(var(--v-theme-primary), 0.09);
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
  border-radius: 13px;
  block-size: 48px;
  inline-size: 48px;
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

.channel-type-card__badge {
  inline-size: fit-content;
  border: 1px solid rgba(37, 211, 102, 0.24);
  border-radius: 999px;
  background: rgba(37, 211, 102, 0.09);
  color: #159447;
  font-size: 0.64rem;
  font-weight: 800;
  letter-spacing: 0.055em;
  margin-block-end: 2px;
  padding: 4px 8px;
  text-transform: uppercase;
}

.channel-type-card__title {
  font-size: 0.98rem;
  font-weight: 750;
  line-height: 1.25;
}

.channel-type-card__description {
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.8rem;
  line-height: 1.5;
}

.channel-type-card__check {
  position: absolute;
  display: inline-grid;
  place-items: center;
  border-radius: 999px;
  background: rgb(var(--v-theme-primary));
  block-size: 26px;
  color: rgb(var(--v-theme-on-primary));
  inline-size: 26px;
  inset-block-start: 13px;
  inset-inline-end: 13px;
  box-shadow: 0 5px 12px rgba(var(--v-theme-primary), 0.28);
}

@media (max-width: 720px) {
  .channel-type-cards {
    grid-template-columns: 1fr;
  }

  .channel-type-card--featured {
    grid-column: auto;
  }
}

@media (prefers-reduced-motion: reduce) {
  .channel-type-card {
    transition: none;
  }

  .channel-type-card:hover {
    transform: none;
  }
}
</style>
