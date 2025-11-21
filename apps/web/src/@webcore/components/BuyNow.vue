<script lang="ts" setup>
import { ref, watch, getCurrentInstance } from 'vue';

const vm = getCurrentInstance();
const buyNowUrl = ref(
  vm?.appContext.config.globalProperties.buyNowUrl ||
    'https://1.envato.market/vuexy_admin'
);

watch(buyNowUrl, (val) => {
  if (vm) vm.appContext.config.globalProperties.buyNowUrl = val;
});

const openBuyNow = () =>
  window.open(buyNowUrl.value, '_blank', 'noopener,noreferrer');
</script>

<template>
  <button type="button" class="buy-now-button d-print-none" @click="openBuyNow">
    Buy Now
    <span class="button-inner" />
  </button>
</template>

<style lang="scss" scoped>
.buy-now-button,
.button-inner {
  display: inline-flex;
  box-sizing: border-box;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 6px;
  margin: 0;
  animation: anime 12s linear infinite;
  appearance: none;
  background: linear-gradient(-45deg, #ffa63d, #ff3d77, #338aff, #3cf0c5);
  background-size: 600%;
  color: rgba(255, 255, 255, 0.9);
  cursor: pointer;
  font-size: 0.9375rem;
  font-weight: 500;
  letter-spacing: 0.43px;
  line-height: 1.2;
  min-inline-size: 50px;
  outline: 0;
  padding-block: 0.625rem;
  padding-inline: 1.25rem;
  text-decoration: none;
  text-transform: none;
  vertical-align: middle;
}

.buy-now-button {
  position: fixed;
  z-index: 999;
  inset-block-end: 5%;
  inset-inline-end: 87px;
}

.buy-now-button:hover {
  color: white;
  text-decoration: none;
}

.buy-now-button .button-inner {
  position: absolute;
  z-index: -1;
  filter: blur(12px);
  inset: 0;
  opacity: 0;
  transition: opacity 200ms ease-in-out;
}

.buy-now-button:not(:hover) .button-inner {
  opacity: 0.8;
}

@keyframes anime {
  0% {
    background-position: 0% 50%;
  }
  50% {
    background-position: 100% 50%;
  }
  100% {
    background-position: 0% 50%;
  }
}
</style>
