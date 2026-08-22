<script setup lang="ts">
defineProps<{
  panelAriaLabel: string;
}>();
</script>

<template>
  <main class="auth-split">
    <div class="auth-split__hero">
      <slot name="hero" />
    </div>

    <section class="auth-split__panel" :aria-label="panelAriaLabel">
      <slot />
    </section>
  </main>
</template>

<style scoped lang="scss">
.auth-split {
  --auth-primary: #0369d1;
  --auth-primary-rgb: 3, 105, 209;
  --auth-primary-strong: #0259b4;
  --auth-accent: #00ecbc;

  display: grid;
  min-block-size: 100dvh;
  grid-template-columns: minmax(0, 1.28fr) minmax(28rem, 0.9fr);
  background: rgb(var(--v-theme-surface));
}

.auth-split__hero {
  min-inline-size: 0;
}

.auth-split__panel {
  position: relative;
  display: grid;
  overflow: hidden;
  min-block-size: 100dvh;
  padding: clamp(2rem, 5vw, 6rem);
  background:
    radial-gradient(
      circle at 100% 0%,
      rgba(var(--auth-primary-rgb), 0.08),
      transparent 32%
    ),
    rgb(var(--v-theme-surface));
  place-items: center;
}

.auth-split__panel::before {
  position: absolute;
  block-size: 17rem;
  inline-size: 17rem;
  border: 1px solid rgba(var(--auth-primary-rgb), 0.12);
  border-radius: 50%;
  content: '';
  inset-block-start: -10rem;
  inset-inline-end: -8rem;
  pointer-events: none;
}

@media (max-width: 1199px) {
  .auth-split {
    grid-template-columns: minmax(0, 1fr) minmax(27rem, 0.88fr);
  }

  .auth-split__panel {
    padding: 3rem;
  }
}

@media (max-width: 959px) {
  .auth-split {
    display: block;
  }

  .auth-split__hero {
    display: none;
  }

  .auth-split__panel {
    min-block-size: 100dvh;
    padding: 3rem;
  }
}

@media (max-width: 599px) {
  .auth-split__panel {
    align-items: start;
    padding: 1.5rem;
    padding-block-start: 2rem;
  }
}
</style>
