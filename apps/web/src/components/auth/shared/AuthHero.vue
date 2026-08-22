<script setup lang="ts">
import type { VNode } from 'vue';
import { VNodeRenderer } from '@layouts/components/VNodeRenderer';

defineProps<{
  appTitle: string;
  description: string;
  eyebrow: string;
  imageSrc: string;
  logo: VNode | VNode[];
  status: string;
  title: string;
}>();

const channels = [
  { icon: 'tabler-brand-whatsapp', label: 'WhatsApp' },
  { icon: 'tabler-api', label: 'WhatsApp API Oficial' },
] as const;
</script>

<template>
  <aside class="login-hero" aria-labelledby="auth-hero-title">
    <img class="login-hero__art" :src="imageSrc" alt="" aria-hidden="true" />

    <div class="login-hero__veil" aria-hidden="true" />
    <div class="login-hero__orb login-hero__orb--one" aria-hidden="true" />
    <div class="login-hero__orb login-hero__orb--two" aria-hidden="true" />

    <div class="login-hero__content">
      <div class="login-hero__brand">
        <span class="login-hero__logo">
          <VNodeRenderer :nodes="logo" />
        </span>
        <span class="login-hero__brand-name">{{ appTitle }}</span>
      </div>

      <div class="login-hero__copy">
        <p class="login-hero__eyebrow">
          <span class="login-hero__eyebrow-line" aria-hidden="true" />
          {{ eyebrow }}
        </p>

        <h1 id="auth-hero-title" class="login-hero__title">
          {{ title }}
        </h1>

        <p class="login-hero__description">
          {{ description }}
        </p>
      </div>

      <div class="login-hero__footer">
        <div class="login-hero__status">
          <span class="login-hero__status-dot" aria-hidden="true" />
          {{ status }}
        </div>

        <ul class="login-hero__channels" aria-label="Canais">
          <li
            v-for="channel in channels"
            :key="channel.label"
            class="login-hero__channel"
          >
            <VIcon :icon="channel.icon" size="17" />
            <span>{{ channel.label }}</span>
          </li>
        </ul>
      </div>
    </div>
  </aside>
</template>

<style scoped lang="scss">
.login-hero {
  position: relative;
  overflow: hidden;
  min-block-size: 100dvh;
  isolation: isolate;
  background: #020b24;
  color: #f4f8ff;
}

.login-hero__art,
.login-hero__veil {
  position: absolute;
  block-size: 100%;
  inline-size: 100%;
  inset: 0;
}

.login-hero__art {
  z-index: -3;
  object-fit: cover;
  object-position: 58% 68%;
  animation: hero-art-arrival 1.4s cubic-bezier(0.22, 1, 0.36, 1) both;
  filter: saturate(0.93) contrast(1.04);
  transform: scale(1.04);
}

.login-hero__veil {
  z-index: -2;
  background:
    linear-gradient(
      90deg,
      rgba(1, 7, 24, 0.94) 0%,
      rgba(1, 7, 24, 0.66) 42%,
      rgba(1, 7, 24, 0.12) 78%
    ),
    linear-gradient(
      180deg,
      rgba(1, 7, 24, 0.28) 0%,
      rgba(1, 7, 24, 0) 45%,
      rgba(1, 7, 24, 0.82) 100%
    );
}

.login-hero__veil::after {
  position: absolute;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 180 180' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.35'/%3E%3C/svg%3E");
  content: '';
  inset: 0;
  opacity: 0.12;
  pointer-events: none;
}

.login-hero__orb {
  position: absolute;
  z-index: -1;
  border: 1px solid rgba(98, 164, 255, 0.22);
  border-radius: 50%;
  background: rgba(3, 105, 209, 0.06);
  box-shadow: 0 0 60px rgba(3, 105, 209, 0.12);
  pointer-events: none;
}

.login-hero__orb--one {
  block-size: 15rem;
  inline-size: 15rem;
  inset-block-start: -7.5rem;
  inset-inline-end: -5rem;
}

.login-hero__orb--two {
  block-size: 8rem;
  inline-size: 8rem;
  inset-block-end: 12%;
  inset-inline-start: -4rem;
}

.login-hero__content {
  display: flex;
  min-block-size: 100dvh;
  flex-direction: column;
  padding: clamp(2rem, 4vw, 4.5rem);
}

.login-hero__brand {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  animation: hero-content-arrival 0.8s 0.08s ease both;
}

.login-hero__logo {
  display: grid;
  block-size: 2.5rem;
  inline-size: 2.2rem;
  place-items: center;
}

.login-hero__brand-name {
  font-size: 1.15rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  text-transform: capitalize;
}

.login-hero__copy {
  max-inline-size: 39rem;
  margin-block-start: clamp(4.5rem, 12vh, 8.5rem);
  animation: hero-content-arrival 0.9s 0.18s ease both;
}

.login-hero__eyebrow {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-block-end: 1.4rem;
  color: #a9cfff;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.login-hero__eyebrow-line {
  display: inline-block;
  block-size: 1px;
  inline-size: 2rem;
  background: #2f86f6;
}

.login-hero__title {
  max-inline-size: 11ch;
  margin: 0;
  color: #f4f8ff;
  font-size: clamp(3rem, 5.25vw, 5.7rem);
  font-weight: 700;
  letter-spacing: -0.065em;
  line-height: 0.94;
  text-wrap: balance;
}

.login-hero__description {
  max-inline-size: 35rem;
  margin: 1.75rem 0 0;
  color: rgba(232, 240, 255, 0.76);
  font-size: clamp(1rem, 1.25vw, 1.15rem);
  line-height: 1.7;
  text-wrap: pretty;
}

.login-hero__footer {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 2rem;
  margin-block-start: auto;
  animation: hero-content-arrival 0.9s 0.32s ease both;
}

.login-hero__status {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  color: rgba(232, 240, 255, 0.78);
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.04em;
}

.login-hero__status-dot {
  display: inline-block;
  block-size: 0.5rem;
  inline-size: 0.5rem;
  border-radius: 50%;
  animation: status-pulse 2.4s ease-in-out infinite;
  background: #00ecbc;
  box-shadow: 0 0 0 0 rgba(0, 236, 188, 0.4);
}

.login-hero__channels {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.login-hero__channel {
  display: flex;
  align-items: center;
  border: 1px solid rgba(190, 215, 255, 0.2);
  border-radius: 999px;
  backdrop-filter: blur(14px);
  background: rgba(3, 13, 43, 0.58);
  color: rgba(240, 246, 255, 0.88);
  gap: 0.45rem;
  padding: 0.55rem 0.8rem;
  font-size: 0.72rem;
  font-weight: 600;
}

@keyframes hero-art-arrival {
  from {
    opacity: 0;
    transform: scale(1.1);
  }

  to {
    opacity: 1;
    transform: scale(1.04);
  }
}

@keyframes hero-content-arrival {
  from {
    opacity: 0;
    transform: translateY(18px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes status-pulse {
  50% {
    box-shadow: 0 0 0 7px rgba(0, 236, 188, 0);
  }
}

@media (max-width: 1199px) {
  .login-hero__content {
    padding: 2.5rem;
  }

  .login-hero__footer {
    align-items: flex-start;
    flex-direction: column;
    gap: 1rem;
  }

  .login-hero__channels {
    justify-content: flex-start;
  }
}

@media (prefers-reduced-motion: reduce) {
  .login-hero__art,
  .login-hero__brand,
  .login-hero__copy,
  .login-hero__footer,
  .login-hero__status-dot {
    animation: none;
  }
}
</style>
