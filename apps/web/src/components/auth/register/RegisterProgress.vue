<script setup lang="ts">
import { computed } from 'vue';

interface RegisterStep {
  icon: string;
  subtitle: string;
  title: string;
}

const props = defineProps<{
  currentStep: number;
  items: RegisterStep[];
  maxStepReached: number;
}>();

const emit = defineEmits<{
  selectStep: [step: number];
}>();

const activeItem = computed(() => props.items[props.currentStep]);

const progressPercentage = computed(() => {
  if (props.items.length === 0) return 0;

  return Math.round(((props.currentStep + 1) / props.items.length) * 100);
});

const progressStyle = computed(() => {
  return { inlineSize: `${progressPercentage.value}%` };
});

const selectStep = (step: number) => {
  if (step <= props.maxStepReached) {
    emit('selectStep', step);
  }
};
</script>

<template>
  <nav class="register-progress" :aria-label="$t('register_progress_label')">
    <div class="register-progress__summary">
      <div class="register-progress__current">
        <span class="register-progress__current-icon">
          <VIcon :icon="activeItem?.icon || 'tabler-device-mobile'" size="17" />
        </span>
        <div>
          <span class="register-progress__count">
            {{
              $t('register_step_counter', {
                current: currentStep + 1,
                total: items.length,
              })
            }}
          </span>
          <strong>{{ activeItem?.title }}</strong>
        </div>
      </div>

      <span class="register-progress__percentage">
        {{ progressPercentage }}%
      </span>
    </div>

    <div class="register-progress__bar" aria-hidden="true">
      <span :style="progressStyle" />
    </div>

    <div class="register-progress__milestones">
      <button
        v-for="(item, index) in items"
        :key="`${item.title}-${index}`"
        type="button"
        class="register-progress__milestone"
        :class="{
          'register-progress__milestone--active': index === currentStep,
          'register-progress__milestone--complete': index < currentStep,
        }"
        :disabled="index > maxStepReached"
        :aria-label="item.title"
        :aria-current="index === currentStep ? 'step' : undefined"
        :title="item.title"
        @click="selectStep(index)"
      >
        <VIcon
          v-if="index <= currentStep"
          :icon="
            index < currentStep
              ? 'tabler-check'
              : item.icon || 'tabler-device-mobile'
          "
          size="13"
        />
        <span v-else aria-hidden="true" />
      </button>
    </div>
  </nav>
</template>

<style scoped>
.register-progress {
  border: 1px solid rgba(20, 60, 112, 0.1);
  border-radius: 1rem;
  padding: 0.85rem 1rem 0.75rem;
  background: rgba(255, 255, 255, 0.72);
  box-shadow: 0 0.8rem 2.5rem -2rem rgba(3, 45, 96, 0.25);
}

.register-progress__summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.register-progress__current {
  display: flex;
  min-inline-size: 0;
  align-items: center;
  gap: 0.65rem;
}

.register-progress__current-icon {
  display: grid;
  flex: 0 0 auto;
  border-radius: 0.6rem;
  background: rgba(3, 105, 209, 0.1);
  block-size: 2rem;
  color: #0369d1;
  inline-size: 2rem;
  place-items: center;
}

.register-progress__current div {
  display: flex;
  min-inline-size: 0;
  flex-direction: column;
}

.register-progress__count {
  color: rgba(45, 50, 57, 0.48);
  font-size: 0.62rem;
  font-weight: 680;
  letter-spacing: 0.08em;
  line-height: 1.2;
  text-transform: uppercase;
}

.register-progress__current strong {
  overflow: hidden;
  margin-block-start: 0.12rem;
  color: #242331;
  font-size: 0.8rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.register-progress__percentage {
  color: #0369d1;
  font-size: 0.73rem;
  font-variant-numeric: tabular-nums;
  font-weight: 750;
}

.register-progress__bar {
  overflow: hidden;
  border-radius: 999px;
  margin-block: 0.65rem 0.5rem;
  background: rgba(31, 66, 111, 0.09);
  block-size: 0.3rem;
}

.register-progress__bar span {
  display: block;
  border-radius: inherit;
  background: linear-gradient(90deg, #0369d1, #2f8cff);
  block-size: 100%;
  box-shadow: 0 0 1rem rgba(3, 105, 209, 0.34);
  transition: inline-size 400ms cubic-bezier(0.22, 1, 0.36, 1);
}

.register-progress__milestones {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-block-start: 0.55rem;
}

.register-progress__milestone {
  display: grid;
  flex: 0 0 auto;
  border: 1px solid rgba(31, 66, 111, 0.13);
  border-radius: 50%;
  padding: 0;
  background: rgba(255, 255, 255, 0.92);
  block-size: 1.45rem;
  color: rgba(41, 63, 91, 0.45);
  cursor: pointer;
  inline-size: 1.45rem;
  place-items: center;
  transition:
    border-color 160ms ease,
    background 160ms ease,
    color 160ms ease,
    transform 160ms ease;
}

.register-progress__milestone span {
  border-radius: 50%;
  background: rgba(41, 63, 91, 0.24);
  block-size: 0.27rem;
  inline-size: 0.27rem;
}

.register-progress__milestone--complete,
.register-progress__milestone--active {
  border-color: #0369d1;
  background: #0369d1;
  color: white;
}

.register-progress__milestone--active {
  outline: 0.22rem solid rgba(3, 105, 209, 0.12);
  transform: scale(1.06);
}

.register-progress__milestone:disabled {
  cursor: default;
}
</style>
