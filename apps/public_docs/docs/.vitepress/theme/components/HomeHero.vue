<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef } from 'vue';
import { publicApiOrigin } from '../apiPublicConfig';

const copied = shallowRef(false);
let resetTimer: ReturnType<typeof setTimeout> | undefined;

const baseUrl = computed(() => `${publicApiOrigin}/v1`);

async function copyBaseUrl() {
  if (typeof navigator === 'undefined') return;

  await navigator.clipboard.writeText(baseUrl.value);
  copied.value = true;
  clearTimeout(resetTimer);
  resetTimer = setTimeout(() => {
    copied.value = false;
  }, 1800);
}

onBeforeUnmount(() => clearTimeout(resetTimer));
</script>

<template>
  <main class="home-hero">
    <section class="home-hero__intro">
      <div class="home-hero__copy">
        <div class="home-hero__eyebrow">
          <span class="home-hero__pulse" aria-hidden="true" />
          API pública · v1
        </div>

        <h1 class="home-hero__title">
          Conversas que fluem
          <em>para além da interface.</em>
        </h1>

        <p class="home-hero__lead">
          Conecte CRM, automações e operações próprias aos recursos de chat,
          etiquetas, setores e usuários da Underchat com API autenticada e
          webhooks de saída assinados.
        </p>

        <div class="home-hero__actions">
          <a
            class="home-hero__button home-hero__button--primary"
            href="/guias/primeiros-passos"
          >
            Fazer a primeira chamada
            <span aria-hidden="true">↗</span>
          </a>
          <a
            class="home-hero__button home-hero__button--ghost"
            href="/referencia-api"
          >
            Explorar endpoints
          </a>
        </div>

        <div class="home-hero__endpoint">
          <span class="home-hero__endpoint-label">Base URL</span>
          <code class="home-hero__endpoint-value">{{ baseUrl }}</code>
          <button
            class="home-hero__copy-button"
            type="button"
            :aria-label="copied ? 'URL copiada' : 'Copiar URL base'"
            @click="copyBaseUrl"
          >
            {{ copied ? 'Copiado' : 'Copiar' }}
          </button>
        </div>
      </div>

      <div class="home-hero__console" aria-label="Exemplo de requisição à API">
        <div class="home-hero__console-bar">
          <div class="home-hero__console-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <span>primeira-chamada.sh</span>
          <span class="home-hero__secure">TLS</span>
        </div>

        <pre
          class="home-hero__code"
        ><code><span class="code-dim">01</span> <span class="code-green">curl</span> --request GET \
<span class="code-dim">02</span>   --url <span class="code-warm">"{{ baseUrl }}/chat?status=my_chats"</span> \
<span class="code-dim">03</span>   --header <span class="code-warm">"keyapi: uc_live_••••••••"</span> \
<span class="code-dim">04</span>   --header <span class="code-warm">"x-underchat-user-id: 0195…"</span>

<span class="code-dim">05</span>
<span class="code-dim">06</span> <span class="code-blue">HTTP/1.1 200 OK</span>
<span class="code-dim">07</span> {
<span class="code-dim">08</span>   <span class="code-warm">"data"</span>: [
<span class="code-dim">09</span>     { <span class="code-warm">"chat_id"</span>: <span class="code-warm">"0195…"</span> }
<span class="code-dim">10</span>   ]
<span class="code-dim">11</span> }</code></pre>

        <div class="home-hero__console-footer">
          <span><i aria-hidden="true" /> Chave isolada por conta</span>
          <span>120 req/min</span>
        </div>
      </div>
    </section>

    <section class="home-hero__facts" aria-label="Escopo da API">
      <div class="home-hero__fact">
        <strong>OpenAPI</strong>
        <span>contrato vivo das operações disponíveis no ambiente</span>
      </div>
      <div class="home-hero__fact">
        <strong>4</strong>
        <span>domínios: chat, etiquetas, setores e usuários</span>
      </div>
      <div class="home-hero__fact">
        <strong>2</strong>
        <span>headers separam a conta do usuário executor</span>
      </div>
    </section>

    <section class="home-hero__paths">
      <div class="home-hero__section-heading">
        <span>Mapa de integração</span>
        <h2>Do sistema externo ao atendimento, sem atalhos ocultos.</h2>
      </div>

      <div class="home-hero__flow" aria-label="Fluxo de integração">
        <article class="home-hero__flow-step">
          <span class="home-hero__flow-index">01</span>
          <h3>Seu sistema</h3>
          <p>CRM, ERP, automação ou produto próprio inicia a operação.</p>
        </article>
        <span class="home-hero__flow-arrow" aria-hidden="true">→</span>
        <article class="home-hero__flow-step home-hero__flow-step--active">
          <span class="home-hero__flow-index">02</span>
          <h3>API Underchat</h3>
          <p>
            A chave identifica a conta; o header de usuário define o executor.
          </p>
        </article>
        <span class="home-hero__flow-arrow" aria-hidden="true">→</span>
        <article class="home-hero__flow-step">
          <span class="home-hero__flow-index">03</span>
          <h3>Operação</h3>
          <p>Mensagens e organização chegam ao mesmo fluxo do painel.</p>
        </article>
      </div>
    </section>

    <section class="home-hero__domains">
      <a class="home-hero__domain home-hero__domain--chat" href="/fluxos/chat">
        <span class="home-hero__domain-tag">01 / Chat</span>
        <h2>Atenda, envie, transfira.</h2>
        <p>
          Liste conversas, consulte mensagens, gerencie contatos e execute o
          ciclo completo de atendimento.
        </p>
        <span class="home-hero__domain-link">Ver fluxo completo <i>↗</i></span>
      </a>

      <a class="home-hero__domain" href="/fluxos/etiquetas">
        <span class="home-hero__domain-tag">02 / Etiquetas</span>
        <h2>Contexto visível.</h2>
        <p>
          Modele etiquetas, cores e status para manter automações e operadores
          na mesma linguagem.
        </p>
        <span class="home-hero__domain-link">Organizar etiquetas <i>↗</i></span>
      </a>

      <a class="home-hero__domain" href="/fluxos/setores">
        <span class="home-hero__domain-tag">03 / Setores</span>
        <h2>Roteamento preciso.</h2>
        <p>
          Consulte equipes, crie áreas e direcione cada conversa ao destino
          certo.
        </p>
        <span class="home-hero__domain-link">Configurar setores <i>↗</i></span>
      </a>

      <a
        class="home-hero__domain home-hero__domain--users"
        href="/fluxos/usuarios"
      >
        <span class="home-hero__domain-tag">04 / Usuários</span>
        <h2>Identidade explícita.</h2>
        <p>
          Sincronize pessoas, papéis, horários, setores e canais com isolamento
          rigoroso por conta.
        </p>
        <span class="home-hero__domain-link">Gerenciar usuários <i>↗</i></span>
      </a>

      <a class="home-hero__domain" href="/guias/webhook">
        <span class="home-hero__domain-tag">05 / Webhook de entrada</span>
        <h2>CRM para atendimento.</h2>
        <p>
          Receba leads, formulários e automações, mapeie os campos e inicie
          conversas na Underchat.
        </p>
        <span class="home-hero__domain-link"
          >Configurar entrada para CRM <i>↗</i></span
        >
      </a>

      <a
        class="home-hero__domain home-hero__domain--outbound"
        href="/guias/webhooks-saida"
      >
        <span class="home-hero__domain-tag">06 / Webhooks de saída</span>
        <h2>Eventos que encontram seu sistema.</h2>
        <p>
          Assine chats, mensagens, entregas e contatos com HMAC, retentativas e
          histórico por endpoint.
        </p>
        <span class="home-hero__domain-link"
          >Receber eventos assinados <i>↗</i></span
        >
      </a>
    </section>

    <section class="home-hero__closing">
      <div>
        <span class="home-hero__closing-kicker">Contrato sempre atual</span>
        <h2>Os campos que a API aceita, direto da fonte.</h2>
      </div>
      <p>
        A referência interativa é renderizada do OpenAPI publicado pela própria
        API. Tipos, obrigatoriedade, exemplos e respostas acompanham cada
        endpoint.
      </p>
      <a href="/referencia-api">Abrir referência da API <span>→</span></a>
    </section>
  </main>
</template>

<style scoped>
.home-hero {
  --hero-ink: #071719;
  --hero-paper: #eef7f3;
  --hero-mint: #00ecbc;
  position: relative;
  overflow: hidden;
  color: var(--vp-c-text-1);
}

.home-hero::before {
  position: absolute;
  z-index: -1;
  top: -180px;
  right: -220px;
  width: 720px;
  height: 720px;
  border: 1px solid color-mix(in srgb, var(--uc-mint) 18%, transparent);
  border-radius: 50%;
  background:
    radial-gradient(
      circle at center,
      color-mix(in srgb, var(--uc-mint) 12%, transparent),
      transparent 62%
    ),
    repeating-radial-gradient(
      circle at center,
      transparent 0 42px,
      color-mix(in srgb, var(--uc-mint) 9%, transparent) 43px 44px
    );
  content: '';
  opacity: 0.7;
  pointer-events: none;
}

.home-hero__intro {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(420px, 0.95fr);
  gap: clamp(48px, 7vw, 110px);
  align-items: center;
  max-width: 1240px;
  min-height: 670px;
  margin: 0 auto;
  padding: 92px 32px 70px;
}

.home-hero__copy {
  animation: hero-rise 700ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

.home-hero__eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 26px;
  color: var(--uc-accent-text);
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.home-hero__pulse {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--uc-mint);
  box-shadow: 0 0 0 6px color-mix(in srgb, var(--uc-mint) 13%, transparent);
  animation: pulse 2.4s ease-in-out infinite;
}

.home-hero__title {
  max-width: 720px;
  margin: 0;
  color: var(--vp-c-text-1);
  font-family: var(--uc-font-display);
  font-size: clamp(56px, 6.2vw, 92px);
  font-weight: 600;
  letter-spacing: -0.055em;
  line-height: 0.91;
}

.home-hero__title em {
  display: block;
  margin-top: 10px;
  color: var(--uc-accent-text);
  font-weight: 500;
}

.home-hero__lead {
  max-width: 650px;
  margin: 32px 0 0;
  color: var(--vp-c-text-2);
  font-size: clamp(17px, 1.6vw, 20px);
  line-height: 1.7;
}

.home-hero__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 34px;
}

.home-hero__button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 18px;
  min-height: 50px;
  padding: 0 20px;
  border: 1px solid var(--uc-border-strong);
  border-radius: 9px;
  font-size: 14px;
  font-weight: 700;
  text-decoration: none;
  transition:
    transform 180ms ease,
    border-color 180ms ease,
    box-shadow 180ms ease;
}

.home-hero__button:hover {
  transform: translateY(-2px);
}

.home-hero__button--primary {
  border-color: var(--uc-mint);
  background: var(--uc-mint);
  box-shadow: 0 14px 32px -18px
    color-mix(in srgb, var(--uc-mint) 80%, transparent);
  color: #06201a;
}

.home-hero__button--ghost {
  background: color-mix(in srgb, var(--vp-c-bg) 72%, transparent);
  color: var(--vp-c-text-1);
}

.home-hero__endpoint {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 14px;
  align-items: center;
  max-width: 620px;
  margin-top: 28px;
  padding: 11px 12px 11px 15px;
  border: 1px solid var(--uc-border-strong);
  border-radius: 10px;
  background: var(--uc-code-panel);
}

.home-hero__endpoint-label {
  color: var(--vp-c-text-3);
  font-family: var(--vp-font-family-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.home-hero__endpoint-value {
  overflow: hidden;
  color: var(--uc-code-text);
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.home-hero__copy-button {
  padding: 6px 9px;
  border: 0;
  border-radius: 6px;
  background: color-mix(in srgb, var(--uc-mint) 12%, transparent);
  color: var(--uc-copy-text);
  font-family: var(--vp-font-family-base);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}

.home-hero__console {
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--uc-mint) 22%, var(--uc-border));
  border-radius: 18px;
  background: #071719;
  box-shadow:
    0 38px 90px -42px rgba(0, 0, 0, 0.72),
    0 0 0 1px rgba(255, 255, 255, 0.02) inset;
  color: #dff5ef;
  animation: hero-rise 800ms 120ms cubic-bezier(0.22, 1, 0.36, 1) both;
  transform: rotate(0.8deg);
}

.home-hero__console-bar {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  min-height: 47px;
  padding: 0 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.025);
  color: #77948d;
  font-family: var(--vp-font-family-mono);
  font-size: 10px;
}

.home-hero__console-dots {
  display: flex;
  gap: 6px;
}

.home-hero__console-dots span {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #29423d;
}

.home-hero__console-dots span:nth-child(2) {
  background: #316a5f;
}

.home-hero__console-dots span:nth-child(3) {
  background: var(--hero-mint);
}

.home-hero__secure {
  justify-self: end;
  color: #53a997;
  letter-spacing: 0.1em;
}

.home-hero__code {
  min-height: 348px;
  margin: 0;
  padding: 28px 24px;
  border: 0;
  background: transparent;
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  line-height: 1.95;
  white-space: pre-wrap;
}

.code-dim {
  color: #38534d;
}
.code-green {
  color: #00ecbc;
}
.code-warm {
  color: #e7dca7;
}
.code-blue {
  color: #7bc4ec;
}

.home-hero__console-footer {
  display: flex;
  justify-content: space-between;
  padding: 13px 18px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  color: #77948d;
  font-family: var(--vp-font-family-mono);
  font-size: 9px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.home-hero__console-footer i {
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-right: 7px;
  border-radius: 50%;
  background: var(--hero-mint);
}

.home-hero__facts {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  max-width: 1240px;
  margin: 0 auto;
  border-block: 1px solid var(--uc-border);
}

.home-hero__fact {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 18px;
  align-items: center;
  padding: 28px 32px;
}

.home-hero__fact + .home-hero__fact {
  border-left: 1px solid var(--uc-border);
}

.home-hero__fact strong {
  color: var(--uc-accent-text);
  font-family: var(--uc-font-display);
  font-size: 44px;
  font-weight: 600;
  line-height: 1;
}

.home-hero__fact span {
  color: var(--vp-c-text-2);
  font-size: 12px;
  line-height: 1.5;
}

.home-hero__paths,
.home-hero__domains,
.home-hero__closing {
  max-width: 1240px;
  margin-inline: auto;
}

.home-hero__paths {
  padding: 112px 32px 80px;
}

.home-hero__section-heading {
  display: grid;
  grid-template-columns: 0.55fr 1.45fr;
  gap: 40px;
  align-items: start;
  margin-bottom: 58px;
}

.home-hero__section-heading span,
.home-hero__closing-kicker {
  color: var(--uc-accent-text);
  font-family: var(--vp-font-family-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.home-hero__section-heading h2,
.home-hero__closing h2 {
  max-width: 770px;
  margin: 0;
  font-family: var(--uc-font-display);
  font-size: clamp(38px, 4.5vw, 62px);
  font-weight: 600;
  letter-spacing: -0.035em;
  line-height: 1.02;
}

.home-hero__flow {
  display: grid;
  grid-template-columns: 1fr auto 1fr auto 1fr;
  gap: 20px;
  align-items: center;
}

.home-hero__flow-step {
  min-height: 190px;
  padding: 26px;
  border: 1px solid var(--uc-border);
  border-radius: 14px;
  background: color-mix(in srgb, var(--vp-c-bg-soft) 76%, transparent);
}

.home-hero__flow-step--active {
  border-color: color-mix(in srgb, var(--uc-mint) 52%, var(--uc-border));
  background:
    linear-gradient(
      145deg,
      color-mix(in srgb, var(--uc-mint) 9%, transparent),
      transparent 60%
    ),
    var(--vp-c-bg-soft);
  box-shadow: 0 22px 54px -38px
    color-mix(in srgb, var(--uc-mint) 80%, transparent);
}

.home-hero__flow-index {
  color: var(--uc-accent-text);
  font-family: var(--vp-font-family-mono);
  font-size: 10px;
}

.home-hero__flow-step h3 {
  margin: 30px 0 9px;
  font-family: var(--uc-font-display);
  font-size: 27px;
}

.home-hero__flow-step p {
  margin: 0;
  color: var(--vp-c-text-2);
  font-size: 13px;
  line-height: 1.65;
}

.home-hero__flow-arrow {
  color: var(--vp-c-text-3);
  font-family: var(--vp-font-family-mono);
}

.home-hero__domains {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  padding: 0 32px 112px;
}

.home-hero__domain {
  display: flex;
  flex-direction: column;
  min-height: 360px;
  padding: 28px;
  border: 1px solid var(--uc-border);
  border-radius: 16px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  text-decoration: none;
  transition:
    transform 240ms cubic-bezier(0.22, 1, 0.36, 1),
    border-color 240ms ease;
}

.home-hero__domain:hover {
  border-color: color-mix(in srgb, var(--uc-mint) 42%, var(--uc-border));
  transform: translateY(-5px);
}

.home-hero__domain--chat {
  background:
    radial-gradient(
      circle at 90% 5%,
      color-mix(in srgb, var(--uc-mint) 17%, transparent),
      transparent 42%
    ),
    var(--vp-c-bg-soft);
}

.home-hero__domain--users {
  background:
    linear-gradient(
      145deg,
      color-mix(in srgb, var(--uc-mint) 8%, transparent),
      transparent 62%
    ),
    var(--vp-c-bg-soft);
}

.home-hero__domain--outbound {
  border-color: color-mix(in srgb, var(--uc-mint) 34%, var(--uc-border));
  background:
    repeating-linear-gradient(
      135deg,
      color-mix(in srgb, var(--uc-mint) 5%, transparent) 0 1px,
      transparent 1px 22px
    ),
    radial-gradient(
      circle at 92% 8%,
      color-mix(in srgb, var(--uc-mint) 17%, transparent),
      transparent 44%
    ),
    var(--vp-c-bg-soft);
}

.home-hero__domain-tag {
  color: var(--uc-accent-text);
  font-family: var(--vp-font-family-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.home-hero__domain h2 {
  margin: 64px 0 14px;
  font-family: var(--uc-font-display);
  font-size: clamp(30px, 3vw, 43px);
  font-weight: 600;
  letter-spacing: -0.035em;
  line-height: 1;
}

.home-hero__domain p {
  margin: 0;
  color: var(--vp-c-text-2);
  font-size: 13px;
  line-height: 1.7;
}

.home-hero__domain-link {
  display: flex;
  justify-content: space-between;
  margin-top: auto;
  padding-top: 30px;
  color: var(--vp-c-text-1);
  font-size: 12px;
  font-weight: 700;
}

.home-hero__domain-link i {
  color: var(--uc-accent-text);
  font-style: normal;
}

.home-hero__closing {
  display: grid;
  grid-template-columns: 1.2fr 0.8fr;
  gap: 50px 80px;
  align-items: end;
  margin-bottom: 80px;
  padding: 62px;
  border-radius: 20px;
  background: #071719;
  color: #eaf8f4;
}

.home-hero__closing-kicker {
  display: block;
  margin-bottom: 26px;
  color: var(--hero-mint);
}

.home-hero__closing h2 {
  color: #f0faf7;
}

.home-hero__closing p {
  margin: 0;
  color: #9cb8b1;
  font-size: 14px;
  line-height: 1.75;
}

.home-hero__closing a {
  grid-column: 2;
  display: flex;
  justify-content: space-between;
  padding-top: 18px;
  border-top: 1px solid rgba(255, 255, 255, 0.15);
  color: var(--hero-mint);
  font-size: 13px;
  font-weight: 700;
  text-decoration: none;
}

@keyframes hero-rise {
  from {
    opacity: 0;
    transform: translateY(26px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes pulse {
  50% {
    box-shadow: 0 0 0 10px color-mix(in srgb, var(--uc-mint) 3%, transparent);
  }
}

@media (max-width: 980px) {
  .home-hero__intro {
    grid-template-columns: 1fr;
    padding-top: 72px;
  }

  .home-hero__console {
    max-width: 680px;
    transform: none;
  }

  .home-hero__facts,
  .home-hero__domains {
    grid-template-columns: 1fr;
  }

  .home-hero__fact + .home-hero__fact {
    border-top: 1px solid var(--uc-border);
    border-left: 0;
  }

  .home-hero__flow {
    grid-template-columns: 1fr;
  }

  .home-hero__flow-arrow {
    justify-self: center;
    transform: rotate(90deg);
  }

  .home-hero__closing {
    grid-template-columns: 1fr;
    margin-inline: 24px;
  }

  .home-hero__closing a {
    grid-column: 1;
  }
}

@media (max-width: 640px) {
  .home-hero__intro,
  .home-hero__paths,
  .home-hero__domains {
    padding-inline: 20px;
  }

  .home-hero__intro {
    gap: 52px;
    min-height: auto;
    padding-block: 58px 48px;
  }

  .home-hero__title {
    font-size: clamp(48px, 16vw, 68px);
  }

  .home-hero__button {
    width: 100%;
  }

  .home-hero__endpoint {
    grid-template-columns: 1fr auto;
  }

  .home-hero__endpoint-label {
    grid-column: 1 / -1;
  }

  .home-hero__console {
    border-radius: 12px;
  }

  .home-hero__code {
    overflow-x: auto;
    min-height: 320px;
    padding: 22px 16px;
    font-size: 10px;
    white-space: pre;
  }

  .home-hero__console-footer {
    gap: 16px;
  }

  .home-hero__facts {
    margin-inline: 20px;
  }

  .home-hero__fact {
    padding-inline: 12px;
  }

  .home-hero__section-heading {
    grid-template-columns: 1fr;
    gap: 20px;
  }

  .home-hero__paths {
    padding-block: 80px 56px;
  }

  .home-hero__domains {
    padding-bottom: 80px;
  }

  .home-hero__domain {
    min-height: 320px;
  }

  .home-hero__closing {
    gap: 32px;
    margin-bottom: 40px;
    padding: 32px 24px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .home-hero__copy,
  .home-hero__console,
  .home-hero__pulse {
    animation: none;
  }

  .home-hero__button,
  .home-hero__domain {
    transition: none;
  }
}
</style>
