<script setup lang="ts">
import type { VNode } from 'vue';
import { VNodeRenderer } from '@layouts/components/VNodeRenderer';

defineProps<{
  appTitle: string;
  channels: string[];
  description: string;
  eyebrow: string;
  imageSrc: string;
  logo: VNode | VNode[];
  status: string;
  title: string;
}>();
</script>

<template>
  <section class="register-hero" aria-labelledby="register-hero-title">
    <img :src="imageSrc" alt="" aria-hidden="true" class="register-hero__art" />
    <div class="register-hero__veil" aria-hidden="true" />
    <div class="register-hero__grain" aria-hidden="true" />

    <header class="register-hero__brand">
      <span class="register-hero__brand-mark">
        <VNodeRenderer :nodes="logo" />
      </span>
      <span>{{ appTitle }}</span>
    </header>

    <div class="register-hero__copy">
      <p class="register-hero__eyebrow">
        <span aria-hidden="true" />
        {{ eyebrow }}
      </p>
      <h1 id="register-hero-title" class="register-hero__title">
        {{ title }}
      </h1>
      <p class="register-hero__description">
        {{ description }}
      </p>
    </div>

    <footer class="register-hero__footer">
      <p class="register-hero__status">
        <span aria-hidden="true" />
        {{ status }}
      </p>

      <div class="register-hero__channels">
        <span
          v-for="(channel, index) in channels"
          :key="channel"
          class="register-hero__channel"
        >
          <VIcon
            :icon="index === 0 ? 'tabler-brand-whatsapp' : 'tabler-api'"
            size="15"
          />
          {{ channel }}
        </span>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.register-hero {
  position: relative;
  display: flex;
  min-block-size: 100dvh;
  flex-direction: column;
  isolation: isolate;
  overflow: hidden;
  padding: clamp(2rem, 4vw, 4.75rem);
  color: #f1f6ff;
}

.register-hero__art,
.register-hero__veil,
.register-hero__grain {
  position: absolute;
  inset: 0;
}

.register-hero__art {
  z-index: -3;
  block-size: 100%;
  inline-size: 100%;
  object-fit: cover;
  object-position: 57% 62%;
  scale: 1.015;
}

.register-hero__veil {
  z-index: -2;
  background:
    linear-gradient(
      90deg,
      rgba(1, 7, 24, 0.88) 0%,
      rgba(1, 7, 24, 0.61) 48%,
      rgba(1, 7, 24, 0.12) 100%
    ),
    linear-gradient(
      180deg,
      rgba(1, 7, 24, 0.32) 0%,
      transparent 38%,
      rgba(1, 7, 24, 0.68) 100%
    );
}

.register-hero__grain {
  z-index: -1;
  opacity: 0.19;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 180 180' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.82' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.17'/%3E%3C/svg%3E");
  mix-blend-mode: soft-light;
  pointer-events: none;
}

.register-hero__brand {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 1.1rem;
  font-weight: 720;
  letter-spacing: -0.025em;
}

.register-hero__brand-mark {
  display: grid;
  block-size: 2.5rem;
  inline-size: 2.25rem;
  place-items: center;
}

.register-hero__copy {
  max-inline-size: 38rem;
  margin-block: auto;
}

.register-hero__eyebrow {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin: 0 0 1.7rem;
  color: #a9cfff;
  font-size: 0.72rem;
  font-weight: 750;
  letter-spacing: 0.22em;
  text-transform: uppercase;
}

.register-hero__eyebrow span {
  block-size: 1px;
  inline-size: 2rem;
  background: #2f86f6;
}

.register-hero__title {
  max-inline-size: 10ch;
  margin: 0;
  color: #f4f8ff;
  font-size: clamp(3.35rem, 5.25vw, 6.2rem);
  font-weight: 750;
  letter-spacing: -0.072em;
  line-height: 0.91;
  text-wrap: balance;
}

.register-hero__description {
  max-inline-size: 34rem;
  margin: 2rem 0 0;
  color: rgba(232, 240, 255, 0.76);
  font-size: clamp(1rem, 1.2vw, 1.14rem);
  line-height: 1.65;
}

.register-hero__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1.5rem;
}

.register-hero__status {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  margin: 0;
  color: rgba(232, 240, 255, 0.76);
  font-size: 0.76rem;
  font-weight: 600;
}

.register-hero__status span {
  border-radius: 50%;
  background: #00ecbc;
  block-size: 0.5rem;
  box-shadow: 0 0 0 0.32rem rgba(0, 236, 188, 0.12);
  inline-size: 0.5rem;
}

.register-hero__channels {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.55rem;
}

.register-hero__channel {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  border: 1px solid rgba(190, 215, 255, 0.2);
  border-radius: 999px;
  padding: 0.5rem 0.8rem;
  backdrop-filter: blur(16px);
  background: rgba(3, 13, 43, 0.42);
  color: rgba(240, 246, 255, 0.88);
  font-size: 0.69rem;
  font-weight: 600;
}

@media (max-width: 1279px) {
  .register-hero {
    padding: 2.5rem;
  }

  .register-hero__footer {
    align-items: flex-start;
    flex-direction: column;
  }

  .register-hero__channels {
    justify-content: flex-start;
  }
}
</style>
