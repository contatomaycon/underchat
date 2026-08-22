import { execFileSync } from 'node:child_process';

import { defineConfig } from 'vitepress';

function hasGitHistory() {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

export default defineConfig({
  lang: 'pt-BR',
  title: 'Underchat Developers',
  description:
    'Documentação oficial da API pública da Underchat para conversas, etiquetas, setores, usuários e webhooks.',
  cleanUrls: true,
  lastUpdated: hasGitHistory(),
  outDir: '../dist',
  head: [
    ['meta', { name: 'theme-color', content: '#071719' }],
    ['meta', { name: 'color-scheme', content: 'light dark' }],
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    [
      'link',
      {
        rel: 'preconnect',
        href: 'https://fonts.gstatic.com',
        crossorigin: '',
      },
    ],
    [
      'link',
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Manrope:wght@400;500;600;700;800&family=Newsreader:opsz,wght@6..72,500;6..72,600&display=swap',
      },
    ],
  ],
  markdown: {
    lineNumbers: true,
    theme: {
      light: 'github-light-high-contrast',
      dark: 'github-dark',
    },
  },
  themeConfig: {
    logo: '/logo.svg',
    siteTitle: 'Underchat Developers',
    nav: [
      { text: 'Visão geral', link: '/' },
      { text: 'Começar', link: '/guias/primeiros-passos' },
      { text: 'Fluxos', link: '/fluxos/chat' },
      { text: 'Referência da API', link: '/referencia-api' },
    ],
    sidebar: {
      '/guias/': [
        {
          text: 'Comece aqui',
          items: [
            { text: 'Primeiros passos', link: '/guias/primeiros-passos' },
            { text: 'Token da API', link: '/guias/token' },
            { text: 'Autenticação keyapi', link: '/guias/autenticacao' },
            { text: 'Base URL e versionamento', link: '/guias/base-url' },
          ],
        },
        {
          text: 'Fundamentos',
          items: [
            { text: 'Respostas e erros', link: '/guias/respostas-erros' },
            { text: 'Paginação e filtros', link: '/guias/paginacao-filtros' },
            { text: 'Uploads e mídia', link: '/guias/uploads' },
            { text: 'Limites de requisição', link: '/guias/rate-limit' },
          ],
        },
        {
          text: 'Webhooks',
          items: [
            {
              text: 'Entrada para CRM',
              link: '/guias/webhook',
            },
            {
              text: 'Saída de eventos',
              link: '/guias/webhooks-saida',
            },
            {
              text: 'Payloads de saída',
              link: '/guias/webhooks-saida-payloads',
            },
            {
              text: 'Receptor em produção',
              link: '/guias/webhooks-saida-receptor',
            },
          ],
        },
      ],
      '/fluxos/': [
        {
          text: 'Fluxos de integração',
          items: [
            { text: 'Chat e atendimento', link: '/fluxos/chat' },
            { text: 'Etiquetas', link: '/fluxos/etiquetas' },
            { text: 'Setores', link: '/fluxos/setores' },
            { text: 'Usuários', link: '/fluxos/usuarios' },
          ],
        },
        {
          text: 'Contrato completo',
          items: [{ text: 'Referência da API', link: '/referencia-api' }],
        },
      ],
    },
    search: {
      provider: 'local',
      options: {
        translations: {
          button: {
            buttonText: 'Buscar na documentação',
            buttonAriaLabel: 'Buscar na documentação',
          },
          modal: {
            noResultsText: 'Nenhum resultado encontrado para',
            resetButtonTitle: 'Limpar busca',
            footer: {
              selectText: 'selecionar',
              navigateText: 'navegar',
              closeText: 'fechar',
            },
          },
        },
      },
    },
    outline: {
      level: [2, 3],
      label: 'Nesta página',
    },
    docFooter: {
      prev: 'Página anterior',
      next: 'Próxima página',
    },
    lastUpdated: {
      text: 'Atualizado em',
      formatOptions: {
        dateStyle: 'long',
        timeStyle: 'short',
      },
    },
    darkModeSwitchLabel: 'Aparência',
    lightModeSwitchTitle: 'Usar tema claro',
    darkModeSwitchTitle: 'Usar tema escuro',
    sidebarMenuLabel: 'Menu',
    returnToTopLabel: 'Voltar ao topo',
    langMenuLabel: 'Idioma',
    notFound: {
      title: 'Página não encontrada',
      quote: 'Este caminho não existe ou foi movido.',
      linkLabel: 'Voltar para a documentação',
      linkText: 'Ir para o início',
    },
    footer: {
      message: 'API pública para integrações seguras e rastreáveis.',
      copyright: `© ${new Date().getFullYear()} Underchat`,
    },
  },
});
