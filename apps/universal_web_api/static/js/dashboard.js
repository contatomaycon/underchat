const { createApp } = Vue

// ========== Definição de elemento Schema ==========

const DEFAULT_SELECTOR_DEFINITIONS = [
    {
        key: "input_box",
        description: "A caixa de entrada onde o usuário insere o texto (textarea ou contenteditable elemento)",
        enabled: true,
        required: true
    },
    {
        key: "send_btn",
        description: "botão para enviar uma mensagem (geralmente type=submit ou um botão com um ícone de envio)",
        enabled: true,
        required: true
    },
    {
        key: "result_container",
        description: "AI Um contêiner para conteúdo de resposta (contendo apenas AI texto de saída, excluindo mensagens do usuário)",
        enabled: true,
        required: true
    },
    {
        key: "new_chat_btn",
        description: "Botão para criar uma nova conversa (clique para iniciar uma nova conversa)",
        enabled: true,
        required: false
    },
    {
        key: "message_wrapper",
        description: "Contêiner completo de mensagem (elemento externo que envolve uma única mensagem, usado para emenda de vários nós)",
        enabled: false,
        required: false
    },
    {
        key: "generating_indicator",
        description: "Gerando indicador (como botão de parada, animação de carregamento, usado para detectar se a saída ainda está sendo produzida)",
        enabled: false,
        required: false
    }
];

// ========== Configuração Schema definição ==========

// Constantes do navegador Schema(Exibição chinesa pura)
const BROWSER_CONSTANTS_SCHEMA = {
    connection: {
        label: 'Configuração de conexão',
        icon: '🔌',
        items: {
            DEFAULT_PORT: {
                label: 'Porta de depuração',
                desc: 'Chrome DevTools Porta de depuração remota',
                type: 'number',
                min: 1024,
                max: 65535,
                default: 9222
            },
            CONNECTION_TIMEOUT: {
                label: 'Tempo limite de conexão',
                unit: 'Segundo',
                desc: 'Tempo limite de conexão do navegador',
                type: 'number',
                min: 1,
                max: 60,
                default: 10
            }
        }
    },
    delay: {
        label: 'Atraso na operação',
        icon: '⏱️',
        desc: 'Faixas de latência aleatórias que simulam a operação humana',
        items: {
            STEALTH_DELAY_MIN: {
                label: 'Limite inferior de atraso furtivo',
                unit: 'Segundo',
                type: 'number',
                step: 0.05,
                min: 0,
                default: 0.1
            },
            STEALTH_DELAY_MAX: {
                label: 'Limite de atraso furtivo',
                unit: 'Segundo',
                type: 'number',
                step: 0.05,
                min: 0,
                default: 0.3
            },
            ACTION_DELAY_MIN: {
                label: 'Limite inferior de atraso de ação',
                unit: 'Segundo',
                type: 'number',
                step: 0.05,
                min: 0,
                default: 0.15
            },
            ACTION_DELAY_MAX: {
                label: 'Limite superior de atraso de ação',
                unit: 'Segundo',
                type: 'number',
                step: 0.05,
                min: 0,
                default: 0.3
            }
        }
    },
    element: {
        label: 'Pesquisa de elemento',
        icon: '🔍',
        items: {
            DEFAULT_ELEMENT_TIMEOUT: {
                label: 'Tempo de espera padrão',
                unit: 'Segundo',
                desc: 'Tempo limite padrão para encontrar elementos',
                type: 'number',
                min: 1,
                default: 3
            },
            FALLBACK_ELEMENT_TIMEOUT: {
                label: 'Tempo de espera de backup',
                unit: 'Segundo',
                desc: 'Tempo limite de nova tentativa após a primeira falha',
                type: 'number',
                min: 0.5,
                default: 1
            },
            ELEMENT_CACHE_MAX_AGE: {
                label: 'Período de validade do cache',
                unit: 'Segundo',
                desc: 'Tempo de cache da posição do elemento',
                type: 'number',
                min: 1,
                default: 5.0
            }
        }
    },
    logging: {
        label: 'registro',
        icon: '🪄',
        items: {
            LOG_INFO_CUTE_MODE: {
                label: 'INFO Deixe seu diário fofo',
                desc: 'Após ligá-lo, a lista de logs dará prioridade à exibição do arquivo polido INFO Redação; o log original não será perdido e o texto original ainda poderá ser visualizado passando o mouse sobre o texto do log.',
                type: 'switch',
                default: false
            },
            LOG_DEBUG_CUTE_MODE: {
                label: 'DEBUG Deixe seu diário fofo',
                desc: 'Após ativá-lo, a lista de logs dará prioridade à exibição dos principais arquivos modificados. DEBUG Redação; o log original não será perdido e o texto original ainda poderá ser visualizado passando o mouse sobre o texto do log.',
                type: 'switch',
                default: false
            }
        }
    },
    stream: {
        label: 'Monitoramento de streaming',
        icon: '📡',
        desc: 'controlar AI Frequência de detecção de resposta e determinação de tempo limite',
        items: {
            STREAM_CHECK_INTERVAL_MIN: {
                label: 'Verifique o limite inferior do intervalo',
                unit: 'Segundo',
                type: 'number',
                step: 0.05,
                min: 0.05,
                default: 0.1
            },
            STREAM_CHECK_INTERVAL_MAX: {
                label: 'Verifique o limite superior do intervalo',
                unit: 'Segundo',
                type: 'number',
                step: 0.1,
                min: 0.1,
                default: 1.0
            },
            STREAM_CHECK_INTERVAL_DEFAULT: {
                label: 'Intervalo de verificação padrão',
                unit: 'Segundo',
                type: 'number',
                step: 0.05,
                min: 0.05,
                default: 0.3
            },
            STREAM_SILENCE_THRESHOLD: {
                label: 'Limite de tempo limite silencioso',
                unit: 'Segundo',
                desc: 'Quanto tempo leva para determinar se não há conteúdo novo?',
                type: 'number',
                min: 1,
                default: 8.0
            },
            STREAM_SILENCE_THRESHOLD_FALLBACK: {
                label: 'Backup de tempo limite silencioso',
                unit: 'Segundo',
                desc: 'Limite alternativo para modelos lentos',
                type: 'number',
                min: 1,
                default: 12
            },
            STREAM_MAX_TIMEOUT: {
                label: 'tempo limite máximo',
                unit: 'Segundo',
                desc: 'Limite de tempo limite absoluto para uma única resposta',
                type: 'number',
                min: 60,
                default: 600
            },
            STREAM_INITIAL_WAIT: {
                label: 'espera inicial',
                unit: 'Segundo',
                desc: 'Tempo máximo de espera pela primeira resposta',
                type: 'number',
                min: 10,
                default: 180
            },
            STREAM_STABLE_COUNT_THRESHOLD: {
                label: 'Número de julgamentos estáveis',
                desc: 'Quantas verificações consecutivas devem ser feitas antes que seja determinado que está completo?',
                type: 'number',
                min: 1,
                default: 8
            }
        }
    },
    streamAdvanced: {
        label: 'Monitoramento de streaming (avançado)',
        icon: '⚙️',
        collapsed: true,
        items: {
            STREAM_RERENDER_WAIT: {
                label: 'Renderizar espera',
                unit: 'Segundo',
                desc: 'Aguarde a página ser renderizada novamente',
                type: 'number',
                step: 0.1,
                default: 0.5
            },
            STREAM_CONTENT_SHRINK_TOLERANCE: {
                label: 'Tempos de tolerância à redução de conteúdo',
                desc: 'O número de vezes que o conteúdo pode ser encurtado',
                type: 'number',
                min: 0,
                default: 3
            },
            STREAM_MIN_VALID_LENGTH: {
                label: 'Comprimento mínimo válido',
                unit: 'personagem',
                desc: 'Comprimento mínimo para que uma resposta seja considerada válida',
                type: 'number',
                min: 1,
                default: 10
            },
            STREAM_INITIAL_ELEMENT_WAIT: {
                label: 'elemento inicial espera',
                unit: 'Segundo',
                type: 'number',
                min: 1,
                default: 10
            },
            STREAM_MAX_ABNORMAL_COUNT: {
                label: 'Número máximo de exceções',
                desc: 'Quantas exceções consecutivas serão feitas antes de abortar?',
                type: 'number',
                min: 1,
                default: 5
            },
            STREAM_MAX_ELEMENT_MISSING: {
                label: 'Número máximo de elementos ausentes',
                type: 'number',
                min: 1,
                default: 10
            },
            STREAM_CONTENT_SHRINK_THRESHOLD: {
                label: 'Limite de redução de conteúdo',
                desc: 'A redução de conteúdo que exceda esta proporção é considerada anormal',
                type: 'number',
                step: 0.05,
                min: 0,
                max: 1,
                default: 0.3
            }
        }
    },
    validation: {
        label: 'Validação de entrada',
        icon: '✅',
        items: {
            MAX_MESSAGE_LENGTH: {
                label: 'Comprimento máximo da mensagem',
                unit: 'personagem',
                type: 'number',
                min: 1000,
                default: 100000
            },
            MAX_MESSAGES_COUNT: {
                label: 'Número máximo de mensagens',
                unit: 'tira',
                type: 'number',
                min: 1,
                default: 100
            }
        }
    },

    // 🆕 Envio de imagem relacionado
    image: {
        label: 'Envio de imagem',
        icon: '🖼️',
        items: {
            UPLOAD_HISTORY_IMAGES: {
                label: 'Faça upload de fotos de conversas históricas',
                desc: 'Ativado: também serão carregadas imagens que aparecem em mensagens históricas; desligado: apenas as imagens nas mensagens deste usuário serão carregadas.',
                type: 'switch',
                default: true
            }
        }
    },
    globalIntercept: {
        label: 'Interceptação de rede global',
        icon: '🛡️',
        collapsed: true,
        items: {
            GLOBAL_NETWORK_INTERCEPTION_ENABLED: {
                label: 'Habilitar escuta residente',
                desc: 'As guias inativas continuam monitorando eventos de rede; quando as tarefas são executadas, elas darão lugar automaticamente ao monitoramento do fluxo de trabalho.',
                type: 'switch',
                default: false
            },
            GLOBAL_NETWORK_INTERCEPTION_LISTEN_PATTERN: {
                label: 'Modo de escuta',
                desc: 'DrissionPage listen.start() de pattern, geralmente usado http',
                type: 'text',
                default: 'http'
            },
            GLOBAL_NETWORK_INTERCEPTION_WAIT_TIMEOUT: {
                label: 'Tempo limite da pesquisa',
                unit: 'Segundo',
                desc: 'wait() Tempo limite de espera único: quanto menor o tempo limite, mais rápida será a resposta, mas maior será a sobrecarga.',
                type: 'number',
                step: 0.1,
                min: 0.1,
                default: 0.5
            },
            GLOBAL_NETWORK_INTERCEPTION_RETRY_DELAY: {
                label: 'Intervalo de novas tentativas de exceção',
                unit: 'Segundo',
                desc: 'Intervalo de reinicialização após exceção do ouvinte',
                type: 'number',
                step: 0.1,
                min: 0.2,
                default: 1.0
            }
        }
    },
    commandPeriodic: {
        label: 'agendamento de comando',
        icon: '⚡',
        collapsed: true,
        items: {
            COMMAND_PERIODIC_CHECK_ENABLED: {
                label: 'Habilitar detecção de ciclo global',
                desc: 'Controla a chave de verificação periódica da página da guia inativa do sistema de comando',
                type: 'switch',
                default: true
            },
            COMMAND_PERIODIC_CHECK_INTERVAL_SEC: {
                label: 'Intervalo de detecção global',
                unit: 'Segundo',
                desc: 'O intervalo de detecção periódica padrão do sistema de comando',
                type: 'number',
                step: 0.5,
                min: 1,
                default: 8.0
            },
            COMMAND_PERIODIC_CHECK_JITTER_SEC: {
                label: 'Detecção global de jitter',
                unit: 'Segundo',
                desc: 'Adicione uma pequena quantidade de instabilidade aleatória à detecção de período para evitar colisões de ritmo fixo',
                type: 'number',
                step: 0.2,
                min: 0,
                default: 2.0
            }
        }
    },
    tabPool: {
        label: 'conjunto de guias',
        icon: '🗂️',
        collapsed: true,
        items: {
            TAB_POOL_MAX_TABS: {
                label: 'Número máximo de páginas de guia',
                desc: 'Ele não será mais incluído automaticamente na página nova guia após a data de expiração.',
                type: 'number',
                min: 1,
                default: 5
            },
            TAB_POOL_MIN_TABS: {
                label: 'Número mínimo de páginas de guia a serem mantidas',
                desc: 'O número mínimo de guias disponíveis que o pool tenta manter',
                type: 'number',
                min: 1,
                default: 1
            },
            TAB_POOL_IDLE_TIMEOUT: {
                label: 'tempo limite de inatividade',
                unit: 'Segundo',
                desc: 'Quanto tempo depois de uma guia ficar inativa antes que ela possa ser reciclada ou redefinida',
                type: 'number',
                min: 10,
                default: 300
            },
            TAB_POOL_ACQUIRE_TIMEOUT: {
                label: 'Ocupar tempo limite de espera',
                unit: 'Segundo',
                desc: 'Obtenha o tempo máximo de espera de uma sessão de guia',
                type: 'number',
                min: 1,
                default: 60
            },
            TAB_POOL_STUCK_TIMEOUT: {
                label: 'Tempo limite de liberação forçada travado',
                unit: 'Segundo',
                desc: 'Depois que a guia estiver ocupada por mais tempo, o sistema tentará cancelar a tarefa e forçar a liberação',
                type: 'number',
                min: 10,
                default: 180
            }
        }
    }
};

// variáveis ​​de ambiente Schema
const ENV_CONFIG_SCHEMA = {
    service: {
        apply: 'service',
        label: 'Configuração de serviço',
        icon: '🖥️',
        items: {
            APP_HOST: {
                label: 'endereço de escuta',
                desc: '0.0.0.0 Permitir acesso externo,127.0.0.1 apenas locais',
                type: 'text',
                default: '127.0.0.1'
            },
            APP_PORT: {
                label: 'porta de escuta',
                type: 'number',
                min: 1,
                max: 65535,
                default: 8199
            },
            PUBLIC_BASE_URL: {
                label: 'Endereço publicamente acessível',
                desc: 'Usado para gerar links acessíveis retornados ao cliente, como endereços de download de imagens',
                type: 'text',
                default: 'http://127.0.0.1:8199'
            },
            APP_DEBUG: {
                label: 'modo de depuração',
                desc: 'ligar API Documentação e erros detalhados',
                type: 'switch',
                default: true
            },
            LOG_LEVEL: {
                label: 'Nível de registro',
                type: 'select',
                options: ['DEBUG', 'INFO', 'WARNING', 'ERROR'],
                default: 'INFO'
            }
        }
    },
    auth: {
        apply: 'service',
        label: 'Configuração de autenticação',
        icon: '🔐',
        items: {
            AUTH_ENABLED: {
                label: 'ativar autenticação',
                type: 'switch',
                default: false
            },
            AUTH_TOKEN: {
                label: 'Bearer Token',
                type: 'password',
                desc: 'AUTH_ENABLED=true Deve ser definido quando',
                default: ''
            }
        }
    },
    cors: {
        apply: 'service',
        label: 'CORS Configuração',
        icon: '🌐',
        items: {
            CORS_ENABLED: {
                label: 'habilitar CORS',
                type: 'switch',
                default: true
            },
            CORS_ORIGINS: {
                label: 'Fontes de origem cruzada permitidas',
                desc: 'Separe múltiplos com vírgulas,* Indica que todos são permitidos',
                type: 'text',
                default: '*'
            }
        }
    },
    browser: {
        apply: 'launcher',
        label: 'Configuração do navegador',
        icon: '🌍',
        items: {
            BROWSER_PORT: {
                label: 'Chrome Porta de depuração',
                type: 'number',
                min: 1024,
                max: 65535,
                default: 9222
            },
            BROWSER_PATH: {
                label: 'Caminho do navegador personalizado',
                desc: 'Opcional, detectado automaticamente quando deixado em branco Chrome、Edge、Brave Aguarde o navegador',
                type: 'text',
                default: ''
            },
            BROWSER_PROFILE_DIR: {
                label: 'Diretório de configuração do navegador',
                desc: 'Se deixado em branco, use o chrome_profile Índice',
                type: 'text',
                default: ''
            },
            BROWSER_PROFILE_NAME: {
                label: 'Nome de configuração do navegador',
                desc: 'Por exemplo Default、Profile 1',
                type: 'text',
                default: ''
            }
        }
    },
    proxy: {
        apply: 'launcher',
        label: 'Configuração do agente',
        icon: '🔀',
        items: {
            PROXY_ENABLED: {
                label: 'Habilitar proxy',
                desc: 'Quando ativado, o navegador acessará a Internet através de um servidor proxy',
                type: 'switch',
                default: false
            },
            PROXY_ADDRESS: {
                label: 'endereço proxy',
                desc: 'apoiar socks5:// ou http:// protocolo',
                type: 'text',
                default: 'socks5://127.0.0.1:1080'
            },
            PROXY_BYPASS: {
                label: 'ignorar proxy',
                desc: 'Não use endereços proxy. Separe vários endereços com vírgulas.',
                type: 'text',
                default: 'localhost,127.0.0.1'
            }
        }
    },
    dashboard: {
        apply: 'service',
        label: 'Dashboard Configuração',
        icon: '📊',
        items: {
            DASHBOARD_ENABLED: {
                label: 'habilitar Dashboard',
                type: 'switch',
                default: true
            },
            DASHBOARD_FILE: {
                label: 'Dashboard caminho do arquivo',
                type: 'text',
                default: 'static/index.html'
            }
        }
    },
    update: {
        apply: 'launcher',
        label: 'Atualizar configuração',
        icon: '🔄',
        items: {
            AUTO_UPDATE_ENABLED: {
                label: 'Habilite atualizações automáticas',
                desc: 'O script de inicialização verifica e aplica atualizações antes da inicialização',
                type: 'switch',
                default: true
            },
            GITHUB_REPO: {
                label: 'GitHub armazém',
                desc: 'O armazém utilizado pela verificação automática de atualização, o formato é owner/repo',
                type: 'text',
                default: 'lumingya/universal-web-api'
            }
        }
    },
    ai: {
        apply: 'service',
        label: 'AI Configuração de análise',
        icon: '🤖',
        desc: 'Auxiliar AI Usado para analisar automaticamente a estrutura da página',
        items: {
            HELPER_API_KEY: {
                label: 'API Key',
                type: 'password',
                default: ''
            },
            HELPER_BASE_URL: {
                label: 'API endereço',
                type: 'text',
                default: 'http://127.0.0.1:5104/v1'
            },
            HELPER_API_PROVIDER: {
                label: 'API provedor',
                desc: 'apoiar auto、openai、gemini、claude',
                type: 'select',
                options: ['auto', 'openai', 'gemini', 'claude'],
                default: 'auto'
            },
            HELPER_MODEL: {
                label: 'Nome do modelo',
                type: 'text',
                default: 'gemini-3.0-pro'
            },
            MAX_HTML_CHARS: {
                label: 'HTML Número máximo de caracteres',
                desc: 'Truncado se excedido para salvar Token',
                type: 'number',
                min: 10000,
                default: 120000
            }
        }
    },
    files: {
        apply: 'service',
        label: 'Arquivo de configuração',
        icon: '📁',
        items: {
            SITES_CONFIG_FILE: {
                label: 'Caminho do arquivo de configuração do site',
                type: 'text',
                default: 'config/sites.json'
            }
        }
    }
};

// ========== Vue aplicativo ==========

const app = createApp({
    data() {
        return {
            // dados
            sites: {},
            currentDomain: null,
            searchQuery: '',

            // UI estado
            toasts: [],
            toastCounter: 0,
            hasLoadedSettings: false,
            hasLoadedMarketplace: false,
            hasLoadedExtractors: false,
            isSaving: false,
            isLoading: false,
            showJsonPreview: false,
            showTokenDialog: false,
            showStepTemplates: false,
            showTestDialog: false,
            showSelectorMenu: false,
            darkMode: false,

            // Tab Alternar (novo settings）
            activeTab: 'config',  // 'config' | 'logs' | 'settings'

            // Recolher status do painel
            selectorCollapsed: true,
            workflowCollapsed: true,

            // Status do navegador
            browserStatus: {
                connected: false,
                tab_url: null,
                tab_title: null
            },

            // Certificação
            authEnabled: false,
            tempToken: '',

            // Teste seletor
            testSelectorInput: '',
            testTimeout: 2,
            testResult: null,
            isTesting: false,
            testHighlight: false,

            // Relacionado ao registro
            logs: [],
            logLevelFilter: 'ALL',
            pauseLogs: false,
            lastLogTimestamp: 0,
            lastLogSeq: 0,
            logPollingTimer: null,

            // ========== Função de importação ==========
            showImportDialog: false,
            importMode: 'merge',  // 'merge' | 'replace'
            importType: 'full',   // 'full' | 'single' (Novo: tipos de importação)
            importedConfig: null,
            importFileName: '',
            singleSiteImportDomain: '',  // Novo: Nome de domínio ao importar um único site

            // ========== Configurações do sistema ==========
            // Configuração do ambiente
            envConfig: {},
            envConfigOriginal: {},
            envCollapsed: {},
            isSavingEnv: false,
            isLoadingEnv: false,

            // Constantes do navegador
            browserConstants: {},
            browserConstantsOriginal: {},
            browserConstantsRaw: {},
            browserConstantsCollapsed: {},
            isSavingConstants: false,
            isLoadingConstants: false,

            // Atualizar lista de permissões
            updatePreserveOptions: [],
            updatePreserveSelected: [],
            updatePreserveSelectedOriginal: [],
            isSavingUpdatePreserve: false,
            isLoadingUpdatePreserve: false,

            // Schema Citar
            envSchema: ENV_CONFIG_SCHEMA,
            browserConstantsSchema: BROWSER_CONSTANTS_SCHEMA,

            // ========== Gerenciamento de definição de elemento ==========
            selectorDefinitions: [],
            selectorDefinitionsOriginal: [],
            isLoadingDefinitions: false,
            isSavingDefinitions: false,
            showAddDefinitionDialog: false,
            newDefinition: {
                key: '',
                description: '',
                enabled: true,
                required: false
            },
            editingDefinitionIndex: null,

            // ========== mercado de plug-ins ==========
            marketplaceCatalog: {
                items: [],
                count: 0,
                total_downloads: 0,
                default_sort: 'downloads',
                source_mode: 'local',
                source_name: 'mercado de alocação',
                source_url: '',
                upload_url: '',
                warning: ''
            },
            marketplaceLoading: false,
            marketplaceError: '',
            marketplaceImportingId: null,
            showMarketplacePreview: false,
            marketplacePreviewData: null,
            marketplacePreviewTitle: '',
            showMarketplaceImportDialog: false,
            marketplacePendingImport: null,
            marketplaceImportStrategy: 'overwrite',
            marketplaceImportPresetName: '',
            showMarketplaceSubmitDialog: false,
            marketplaceSubmitSaving: false,
            marketplaceCommandOptions: [],
            marketplaceCommandLoading: false,
            marketplaceSubmitForm: {
                item_type: 'site_config',
                title: '',
                summary: '',
                author: 'Postagem principal',
                site_domain: '',
                category: '',
                preset_name: '',
                compatibility: '',
                version: '1.0.0',
                tagsText: '',
                selected_command_ids: []
            },

        }
    },

    computed: {
        filteredSites() {
            const keys = Object.keys(this.sites).sort()
            return this.searchQuery
                ? keys.filter(d => d.toLowerCase().includes(this.searchQuery.toLowerCase()))
                : keys
        },

        currentConfig() {
            return this.currentDomain ? this.sites[this.currentDomain] : null
        },

        hasToken() {
            return !!localStorage.getItem('api_token')
        },

        // Registros filtrados
        filteredLogs() {
            if (this.logLevelFilter === 'ALL') {
                return this.logs;
            }
            return this.logs.filter(log => log.level === this.logLevelFilter);
        },

        // Verifique se a configuração do ambiente mudou
        envConfigChanged() {
            return JSON.stringify(this.envConfig) !== JSON.stringify(this.envConfigOriginal);
        },

        // Detectar se as constantes do navegador foram alteradas
        browserConstantsChanged() {
            return JSON.stringify(this.browserConstants) !== JSON.stringify(this.browserConstantsOriginal);
        },

        // Detectar se a definição do elemento foi alterada
        selectorDefinitionsChanged() {
            return JSON.stringify(this.selectorDefinitions) !== JSON.stringify(this.selectorDefinitionsOriginal);
        },

        // Detectar se há alterações na lista de permissões atualizada
        updatePreserveChanged() {
            return JSON.stringify(this.updatePreserveSelected) !== JSON.stringify(this.updatePreserveSelectedOriginal);
        }
    },

    watch: {
        activeTab(tab) {
            this.ensureTabDataLoaded(tab)
        },
        darkMode() {
            this.applyDarkMode()
        }
    },

    mounted() {
        // Leia as configurações do modo noturno
        let savedDarkMode = null
        try {
            savedDarkMode = localStorage.getItem('darkMode')
        } catch (e) {
            savedDarkMode = null
        }
        if (savedDarkMode !== null) {
            this.darkMode = savedDarkMode === 'true'
        } else {
            this.darkMode = window.matchMedia('(prefers-color-scheme: dark)').matches
        }
        this.applyDarkMode()

        // Inicializar estado dobrado
        this.initCollapsedStates()

        this.initializeDashboard()

        // Iniciar pesquisa de log (a cada 1 Segundo)

        // Carregar configurações do sistema

        // Carregar definição de elemento

        // Carregar lista de extratores
    },

    beforeUnmount() {
        this.stopLogPolling()
    },

    methods: {
        async initializeDashboard() {
            await Promise.all([
                this.loadConfig(true),
                this.loadHealthStatus({ silent: true })
            ])

            this.startLogPolling()
            this.ensureTabDataLoaded(this.activeTab)
        },

        startLogPolling() {
            if (this.logPollingTimer) {
                return
            }

            this.pollLogs()
            this.logPollingTimer = setInterval(() => {
                this.pollLogs()
            }, 1000)
        },

        stopLogPolling() {
            if (!this.logPollingTimer) {
                return
            }

            clearInterval(this.logPollingTimer)
            this.logPollingTimer = null
        },
        // ========== inicialização ==========

        initCollapsedStates() {
            // O agrupamento de configuração de ambiente é recolhido por padrão
            for (const key of Object.keys(ENV_CONFIG_SCHEMA)) {
                this.envCollapsed[key] = true;
            }
            // O agrupamento de constantes do navegador é recolhido por padrão
            for (const [key] of Object.entries(BROWSER_CONSTANTS_SCHEMA)) {
                this.browserConstantsCollapsed[key] = true;
            }
        },

        // ========== Modo noturno ==========

        applyDarkMode() {
            const isDark = !!this.darkMode
            const targets = [
                document.documentElement,
                document.body,
                document.getElementById('app')
            ].filter(Boolean)
            for (const el of targets) {
                el.classList.remove('dark', 'light')
                el.classList.add(isDark ? 'dark' : 'light')
                el.setAttribute('data-theme', isDark ? 'dark' : 'light')
            }
            document.documentElement.style.colorScheme = isDark ? 'dark' : 'light'
        },

        toggleDarkMode() {
            this.darkMode = !this.darkMode
            this.applyDarkMode()
            try {
                localStorage.setItem('darkMode', this.darkMode.toString())
            } catch (e) {
                // ignore storage failures and keep runtime theme switch available
            }
            this.notify('Mudou para' + (this.darkMode ? 'à noite' : 'dia') + 'modelo', 'success')
        },

        // ========== Menu seletor ==========

        toggleSelectorMenu() {
            this.showSelectorMenu = !this.showSelectorMenu
        },

        closeAllMenus() {
            this.showSelectorMenu = false
        },

        // ========== API chamar ==========

        async apiRequest(url, options = {}) {
            const token = localStorage.getItem('api_token')
            const headers = {
                'Content-Type': 'application/json',
                ...options.headers
            }

            if (token) {
                headers['Authorization'] = 'Bearer ' + token
            }

            try {
                const response = await fetch(url, {
                    ...options,
                    headers
                })

                if (!response.ok) {
                    if (response.status === 401) {
                        this.notify('Falha na autenticação, verifique Token', 'error')
                        this.showTokenDialog = true
                        throw new Error('UNAUTHORIZED')
                    }

                    const errorData = await response.json().catch(() => ({}))
                    throw new Error(errorData.detail || 'Falha na solicitação (' + response.status + ')')
                }

                return await response.json()
            } catch (error) {
                if (error.message !== 'UNAUTHORIZED') {
                    console.error('API Erro de solicitação:', error)
                }
                throw error
            }
        },

        async loadConfig(silent) {
            // defesa:@click="loadConfig" será passado em Event O objeto precisa ser filtrado
            if (typeof silent !== 'boolean') {
                silent = false
            }

            this.isLoading = true
            try {
                const data = await this.apiRequest('/api/config')
                this.sites = this.normalizeConfig(data)

                if (!this.currentDomain && Object.keys(this.sites).length > 0) {
                    this.currentDomain = Object.keys(this.sites)[0]
                }

                if (!silent) {
                    this.notify('A configuração foi atualizada (' + Object.keys(this.sites).length + ' sites)', 'success')
                }
                return true
            } catch (error) {
                this.notify('Falha ao carregar a configuração: ' + error.message, 'error')
                this.sites = {}
                return false
            } finally {
                this.isLoading = false
            }
        },

        async saveConfig() {
            if (!this.validateConfig()) {
                return
            }

            this.isSaving = true
            try {
                await this.apiRequest('/api/config', {
                    method: 'POST',
                    body: JSON.stringify({ config: this.sites })
                })
                this.notify('Configuração salva', 'success')
            } catch (error) {
                this.notify('Falha ao salvar: ' + error.message, 'error')
            } finally {
                this.isSaving = false
            }
        },

        async refreshStatus() {
            const [configOk, healthOk] = await Promise.all([
                this.loadConfig(true),
                this.loadHealthStatus()
            ])

            if (configOk || healthOk) {
                this.notify('O status foi atualizado', 'success')
            } else {
                this.notify('Falha na atualização', 'error')
            }
        },

        async loadHealthStatus({ silent = false } = {}) {
            try {
                const health = await this.apiRequest('/health')
                this.browserStatus = health.browser || {}
                this.authEnabled = health.config?.auth_enabled || false
                return true
            } catch (error) {
                if (error.message === 'UNAUTHORIZED') {
                    this.authEnabled = true
                    return true
                }

                console.error('Falha na verificação de status:', error)
                if (!silent) {
                    this.notify('Falha na verificação de status: ' + error.message, 'error')
                }
                return false
            }
        },

        async checkAuth() {
            return this.loadHealthStatus({ silent: true })
        },

        async testSelector(key, selector) {
            if (!selector) {
                this.notify('O seletor está vazio', 'warning')
                return
            }

            this.testSelectorInput = selector
            this.showTestDialog = true
            this.testResult = null

            await this.runTest()
        },

        async runTest() {
            if (!this.testSelectorInput) return

            this.isTesting = true
            this.testResult = null

            try {
                const result = await this.apiRequest('/api/debug/test-selector', {
                    method: 'POST',
                    body: JSON.stringify({
                        selector: this.testSelectorInput,
                        timeout: this.testTimeout,
                        highlight: this.testHighlight
                    })
                })

                this.testResult = result

                if (result.success) {
                    if (result.count > 1) {
                        this.notify('✅ virar para cima ' + result.count + ' elementos' + (this.testHighlight ? ', todos destacados' : ''), 'success')
                    } else {
                        this.notify('✅ O seletor é válido' + (this.testHighlight ? ', destacado' : ''), 'success')
                    }
                } else {
                    this.notify('❌ Seletor inválido', 'error')
                }
            } catch (error) {
                this.testResult = {
                    success: false,
                    message: error.message
                }
                this.notify('teste falhou: ' + error.message, 'error')
            } finally {
                this.isTesting = false
            }
        },

        async testCurrentSite() {
            if (!this.currentConfig || Object.keys(this.currentConfig.selectors).length === 0) {
                this.notify('Não há seletor para o site atual', 'warning')
                return
            }

            this.notify('Iniciar testes em lote...', 'info')

            let successCount = 0
            let failCount = 0

            for (const [key, selector] of Object.entries(this.currentConfig.selectors)) {
                if (!selector) continue

                try {
                    const result = await this.apiRequest('/api/debug/test-selector', {
                        method: 'POST',
                        body: JSON.stringify({
                            selector: selector,
                            timeout: 2
                        })
                    })

                    if (result.success) {
                        successCount++
                        console.log('✅ ' + key + ': ' + selector)
                    } else {
                        failCount++
                        console.warn('❌ ' + key + ': ' + selector)
                    }
                } catch (error) {
                    failCount++
                    console.error('❌ ' + key + ': ' + error.message)
                }
            }

            this.notify('Teste concluído: ' + successCount + ' sucesso, ' + failCount + ' falhar',
                failCount > 0 ? 'warning' : 'success')
        },

        async reanalyzeCurrentSite() {
            if (!this.currentDomain) return

            if (!confirm('Confirme para excluir ' + this.currentDomain + ' configurar e reanalisar?\n\nA reanálise requer que o navegador esteja visitando o site no momento.')) {
                return
            }

            try {
                await this.apiRequest('/api/config/' + this.currentDomain, {
                    method: 'DELETE'
                })

                this.notify('A configuração foi excluída. Atualize a página. AI Reanalisar', 'info')

                delete this.sites[this.currentDomain]
                this.currentDomain = null
            } catch (error) {
                this.notify('Falha na exclusão: ' + error.message, 'error')
            }
        },
        // ========== Configuração de imagem (Novo) ==========

        // 🆕 Atualizar configuração de imagem
        async updateImageConfig(newConfig) {
            if (!this.currentDomain || !this.currentConfig) return;

            const pc = this.getActivePresetConfig()
            if (pc) pc.image_extraction = newConfig;

            try {
                const presetName = this.getActivePresetName()
                const payload = { ...newConfig, preset_name: presetName }
                await this.apiRequest(`/api/sites/${this.currentDomain}/image-config`, {
                    method: 'PUT',
                    body: JSON.stringify(payload)
                });
                this.notify('Configuração de imagem salva', 'success');
            } catch (error) {
                console.error('Falha ao salvar a configuração da imagem:', error);
                this.notify('Falha ao salvar a configuração da imagem: ' + error.message, 'error');
            }
        },

        // 🆕 Extração de imagem de teste
        async testImageExtraction() {
            if (!this.currentDomain) {
                this.notify('Selecione um site primeiro', 'warning'); // Adapte-se ao atual notify método
                return;
            }

            this.notify('A função de teste de extração de imagem está em desenvolvimento...', 'info');
            // TODO: Implementar lógica de teste
            // Você pode enviar uma solicitação de teste e exibir a imagem retornada
        },

        // 🆕 Recarregue a configuração atual do site (chamada após aplicar a predefinição)
        async reloadConfig() {
            if (!this.currentDomain) return;

            try {
                const data = await this.apiRequest('/api/config/' + encodeURIComponent(this.currentDomain));
                // Os dados retornados já estão no formato predefinido { presets: { ... } }
                // Padronize-o para garantir a integridade estrutural
                const normalized = this.normalizeConfig({ [this.currentDomain]: data })
                if (normalized[this.currentDomain]) {
                    this.sites[this.currentDomain] = normalized[this.currentDomain]
                }
                this.notify('A configuração foi recarregada', 'success');
            } catch (error) {
                console.error('Falha ao recarregar a configuração:', error);
                this.notify('Falha no carregamento: ' + error.message, 'error');
            }
        },
        // ========== Relacionado ao registro ==========

        async pollLogs() {
            if (this.pauseLogs) return;

            try {
                const result = await this.apiRequest('/api/logs?after_seq=' + this.lastLogSeq);

                if (result.logs && result.logs.length > 0) {
                    result.logs.forEach(log => {
                        const messageText = log.message_text || log.display_message || log.message || '';
                        const kind = log.kind || log.level;
                        this.logs.push({
                            id: log.seq || (Date.now() + Math.random()),
                            seq: log.seq || 0,
                            timestamp: new Date(log.timestamp * 1000).toLocaleTimeString() + '.' +
                                String(Math.floor((log.timestamp % 1) * 1000)).padStart(3, '0'),
                            level: this.normalizeLogLevel(kind, messageText),
                            rawLevel: String(log.level || '').toUpperCase(),
                            kind: String(kind || '').toUpperCase(),
                            logger: log.logger || '',
                            requestId: log.request_id || 'SYSTEM',
                            message: log.display_message || log.message || messageText,
                            messageText,
                            originalMessageText: log.original_message_text || messageText,
                            messageAlias: log.message_alias || ''
                        });
                    });

                    if (this.logs.length > 500) {
                        this.logs = this.logs.slice(-500);
                    }

                    this.$nextTick(() => {
                        if (this.$refs.logContainer) {
                            this.$refs.logContainer.scrollTop = this.$refs.logContainer.scrollHeight;
                        }
                    });
                }
                this.lastLogSeq = Number(result.next_seq || this.lastLogSeq || 0);
                this.lastLogTimestamp = Number(result.timestamp || this.lastLogTimestamp || 0);
            } catch (error) {
                console.debug('Falha na pesquisa de registro:', error.message);
            }
        },

        normalizeLogLevel(level, message) {
            const normalized = String(level || '').toUpperCase();
            if (normalized === 'WARNING') return 'WARN';
            if (normalized === 'CRITICAL') return 'ERROR';
            if (normalized === 'SUCCESS') return 'OK';
            if (normalized === 'DEBUG' || normalized === 'WARN' || normalized === 'ERROR') {
                return normalized;
            }

            if (normalized === 'INFO') {
                if (message.includes('[AI]')) return 'AI';
                if (message.includes('[OK]') || message.includes('[SUCCESS]') || message.includes('✅')) return 'OK';
                return 'INFO';
            }

            if (message.includes('[AI]')) return 'AI';
            if (message.includes('[ERROR]')) return 'ERROR';
            if (message.includes('[WARN]') || message.includes('[WARNING]')) return 'WARN';
            if (message.includes('[OK]') || message.includes('[SUCCESS]') || message.includes('✅')) return 'OK';
            return 'INFO';
        },

        getLogColorClass(level) {
            const colors = {
                'INFO': 'bg-green-50 dark:bg-green-900/20',
                'AI': 'bg-purple-50 dark:bg-purple-900/20',
                'OK': 'bg-green-50 dark:bg-green-900/20',
                'WARN': 'bg-yellow-50 dark:bg-yellow-900/20',
                'ERROR': 'bg-red-50 dark:bg-red-900/20',
                'KEY': 'bg-sky-50 dark:bg-sky-900/20'
            };
            return colors[level] || colors['INFO'];
        },

        getLogLevelClass(level) {
            const colors = {
                'INFO': 'text-green-600 dark:text-green-400',
                'AI': 'text-purple-600 dark:text-purple-400',
                'OK': 'text-green-600 dark:text-green-400',
                'WARN': 'text-yellow-600 dark:text-yellow-400',
                'ERROR': 'text-red-600 dark:text-red-400',
                'KEY': 'text-sky-500 dark:text-sky-300'
            };
            return colors[level] || colors['INFO'];
        },

        clearLogs() {
            if (confirm('Tem certeza de que deseja limpar todos os registros?')) {
                this.logs = [];

                this.apiRequest('/api/logs', { method: 'DELETE' })
                    .catch(() => { });

                this.notify('Registro limpo', 'success');
            }
        },

        // ========== Função de importação (suporta volume total e site único) ==========

        triggerImport() {
            this.$refs.importFileInput.click();
        },

        handleImportFile(event) {
            const file = event.target.files[0];
            if (!file) return;

            this.importFileName = file.name;

            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const config = JSON.parse(e.target.result);

                    // Verifique se é um site único ou uma configuração completa
                    const detectResult = this.detectConfigType(config);

                    if (!detectResult.valid) {
                        this.notify('Formato de arquivo de importação inválido', 'error');
                        return;
                    }

                    this.importType = detectResult.type;
                    this.importedConfig = detectResult.normalizedConfig;
                    this.singleSiteImportDomain = detectResult.suggestedDomain || '';
                    this.showImportDialog = true;
                } catch (error) {
                    this.notify('JSON Falha na análise: ' + error.message, 'error');
                }
            };
            reader.readAsText(file);

            event.target.value = '';
        },

        // Tipo de configuração de detecção: configuração completa or Configuração de site único
        detectConfigType(config) {
            if (typeof config !== 'object' || config === null || Array.isArray(config)) {
                return { valid: false };
            }

            // Verifique se é formato de site único (formato antigo selectors/workflowou novo formato presets/default_preset）
            if (
                config.selectors !== undefined
                || config.workflow !== undefined
                || (config.presets && typeof config.presets === 'object' && !Array.isArray(config.presets))
            ) {
                // formato de site único
                if (!this.validateSingleSiteConfig(config)) {
                    return { valid: false };
                }

                // Tente extrair o nome de domínio do nome do arquivo
                let suggestedDomain = '';
                const match = this.importFileName.match(/^(.+?)(?:-config)?(?:-\d+)?\.json$/i);
                if (match) {
                    suggestedDomain = match[1];
                }

                return {
                    valid: true,
                    type: 'single',
                    normalizedConfig: config,
                    suggestedDomain: suggestedDomain
                };
            }

            // Verifique se está no formato completo (nome de domínio -> configuração)
            if (!this.validateImportedConfig(config)) {
                return { valid: false };
            }

            return {
                valid: true,
                type: 'full',
                normalizedConfig: config
            };
        },

        validateSingleSiteConfig(config) {
            if (typeof config !== 'object' || config === null || Array.isArray(config)) {
                return false;
            }

            if (config.presets !== undefined) {
                if (typeof config.presets !== 'object' || config.presets === null || Array.isArray(config.presets)) {
                    return false;
                }

                for (const presetData of Object.values(config.presets)) {
                    if (typeof presetData !== 'object' || presetData === null || Array.isArray(presetData)) {
                        return false;
                    }

                    if (presetData.selectors !== undefined && (typeof presetData.selectors !== 'object' || Array.isArray(presetData.selectors))) {
                        return false;
                    }

                    if (presetData.workflow !== undefined && !Array.isArray(presetData.workflow)) {
                        return false;
                    }
                }

                return true;
            }

            // selectors Deve ser um objeto, se presente
            if (config.selectors !== undefined && (typeof config.selectors !== 'object' || Array.isArray(config.selectors))) {
                return false;
            }

            // workflow Deve ser uma matriz, se presente
            if (config.workflow !== undefined && !Array.isArray(config.workflow)) {
                return false;
            }

            return true;
        },

        validateImportedConfig(config) {
            if (typeof config !== 'object' || config === null || Array.isArray(config)) {
                return false;
            }

            for (const [domain, siteConfig] of Object.entries(config)) {
                if (!domain || typeof domain !== 'string') {
                    return false;
                }

                if (!this.validateSingleSiteConfig(siteConfig)) {
                    return false;
                }
            }

            return true;
        },

        mergeSiteConfigs(existingSite, importedSite) {
            const normalizedImported = this.normalizeConfig({ imported: importedSite || {} }).imported
            if (!normalizedImported) {
                return existingSite || null
            }

            if (!existingSite) {
                return normalizedImported
            }

            const normalizedExisting = this.normalizeConfig({ existing: existingSite }).existing || {
                default_preset: 'predefinição mestre',
                presets: {}
            }

            const mergedPresets = {
                ...(normalizedExisting.presets || {}),
                ...(normalizedImported.presets || {})
            }

            let mergedDefault = normalizedImported.default_preset
            if (!mergedDefault || !mergedPresets[mergedDefault]) {
                mergedDefault = normalizedExisting.default_preset
            }
            if (!mergedDefault || !mergedPresets[mergedDefault]) {
                mergedDefault = mergedPresets['predefinição mestre'] ? 'predefinição mestre' : (Object.keys(mergedPresets)[0] || 'predefinição mestre')
            }

            return {
                ...normalizedExisting,
                ...normalizedImported,
                presets: mergedPresets,
                default_preset: mergedDefault
            }
        },

        async executeImport() {
            if (!this.importedConfig) return;

            if (this.importType === 'single') {
                // Importação de site único
                const domain = this.singleSiteImportDomain.trim();
                if (!domain) {
                    this.notify('Insira o nome de domínio do site', 'warning');
                    return;
                }

                const normalizedMap = this.normalizeConfig({ [domain]: this.importedConfig });
                const normalizedSite = normalizedMap[domain];
                if (!normalizedSite) {
                    this.notify('Formato de arquivo de importação inválido', 'error');
                    return;
                }

                const exists = !!this.sites[domain];
                if (exists) {
                    const message = this.importMode === 'replace'
                        ? 'site "' + domain + '" Já existe. A configuração atual do site será totalmente substituída. Você quer continuar?'
                        : 'site "' + domain + '" Já existe. Ele será mesclado e importado de acordo com a predefinição. A predefinição com o mesmo nome será substituída. Você quer continuar?';
                    if (!confirm(message)) {
                        return;
                    }
                }

                this.sites[domain] = this.importMode === 'replace'
                    ? normalizedSite
                    : this.mergeSiteConfigs(this.sites[domain], normalizedSite);
                this.currentDomain = domain;

                try {
                    await this.apiRequest('/api/config', {
                        method: 'POST',
                        body: JSON.stringify({ config: this.sites })
                    });

                    this.notify('Site importado com sucesso: ' + domain, 'success');
                } catch (error) {
                    this.notify('Falha ao salvar: ' + error.message, 'error');
                }
            } else {
                // Importação completa
                const importCount = Object.keys(this.importedConfig).length;

                if (this.importMode === 'replace') {
                    this.sites = this.normalizeConfig(this.importedConfig);
                } else {
                    const normalized = this.normalizeConfig(this.importedConfig);
                    this.sites = { ...this.sites, ...normalized };
                }

                try {
                    await this.apiRequest('/api/config', {
                        method: 'POST',
                        body: JSON.stringify({ config: this.sites })
                    });

                    this.notify('Importado com sucesso ' + importCount + ' configuração do site', 'success');
                } catch (error) {
                    this.notify('Falha ao salvar: ' + error.message, 'error');
                }

                if (!this.currentDomain && Object.keys(this.sites).length > 0) {
                    this.currentDomain = Object.keys(this.sites)[0];
                }
            }

            // limpar
            this.showImportDialog = false;
            this.importedConfig = null;
            this.importFileName = '';
            this.singleSiteImportDomain = '';
        },

        cancelImport() {
            this.showImportDialog = false;
            this.importedConfig = null;
            this.importFileName = '';
            this.singleSiteImportDomain = '';
        },

        // ========== Função de exportação (suporta volume total e site único) ==========

        exportConfig() {
            const dataStr = JSON.stringify(this.sites, null, 2)
            const blob = new Blob([dataStr], { type: 'application/json' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = 'sites-config-' + Date.now() + '.json'
            a.click()
            URL.revokeObjectURL(url)

            this.notify('A configuração completa foi exportada', 'success')
        },

        // Exportar um único site
        exportSingleSite(domain) {
            if (!domain || !this.sites[domain]) {
                this.notify('Site não existe', 'error');
                return;
            }

            // Exporte o site inteiro (com todas as predefinições)
            const siteConfig = this.sites[domain];
            const dataStr = JSON.stringify(siteConfig, null, 2);
            const blob = new Blob([dataStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = domain + '-config.json';
            a.click();
            URL.revokeObjectURL(url);

            this.notify('Configuração do site exportada: ' + domain, 'success');
        },

        // Exportar site atual
        exportCurrentSite() {
            if (!this.currentDomain) {
                this.notify('Selecione um site primeiro', 'warning');
                return;
            }
            this.exportSingleSite(this.currentDomain);
        },

        triggerSettingsBackupImport() {
            if (this.$refs.backupImportInput) {
                this.$refs.backupImportInput.click();
            }
        },

        handleSettingsBackupImportFile(event) {
            const file = event.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const payload = JSON.parse(e.target.result);
                    await this.importSettingsBackup(payload);
                } catch (error) {
                    this.notify('Falha na importação de backup completo: ' + error.message, 'error');
                }
            };
            reader.readAsText(file, 'utf-8');

            event.target.value = '';
        },

        getDashboardPreferencesBackup() {
            let apiToken = '';
            try {
                apiToken = localStorage.getItem('api_token') || '';
            } catch (e) {
                apiToken = '';
            }

            return {
                dark_mode: !!this.darkMode,
                api_token: apiToken
            };
        },

        applyDashboardPreferencesBackup(preferences) {
            if (!preferences || typeof preferences !== 'object') return;

            if (typeof preferences.dark_mode === 'boolean') {
                this.darkMode = preferences.dark_mode;
            }

            if (typeof preferences.api_token === 'string') {
                const token = preferences.api_token.trim();
                try {
                    if (token) {
                        localStorage.setItem('api_token', token);
                    } else {
                        localStorage.removeItem('api_token');
                    }
                } catch (e) { }
                this.tempToken = token;
            }
        },

        async exportSettingsBackup() {
            try {
                const payload = await this.apiRequest('/api/settings/backup');
                const exportPayload = {
                    ...payload,
                    dashboard_preferences: this.getDashboardPreferencesBackup()
                };
                const dataStr = JSON.stringify(exportPayload, null, 2);
                const blob = new Blob([dataStr], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'settings-backup-' + Date.now() + '.json';
                a.click();
                URL.revokeObjectURL(url);

                this.notify('Backup completo da configuração exportado', 'success');
            } catch (error) {
                this.notify('Falha na exportação de backup completo: ' + error.message, 'error');
            }
        },

        async importSettingsBackup(payload) {
            if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
                throw new Error('O formato do arquivo de backup é inválido');
            }

            const result = await this.apiRequest('/api/settings/backup', {
                method: 'POST',
                body: JSON.stringify(payload)
            });

            this.applyDashboardPreferencesBackup(payload.dashboard_preferences);

            if (!result.will_restart) {
                await Promise.all([
                    this.loadConfig(true),
                    this.loadEnvConfig(),
                    this.loadBrowserConstants(),
                    this.loadUpdatePreserveSettings(),
                    this.loadSelectorDefinitions()
                ]);
            }

            const sections = Array.isArray(result.imported_sections)
                ? result.imported_sections.join('、')
                : '';
            this.notify(
                result.will_restart
                    ? 'O backup completo foi importado e o serviço será reiniciado automaticamente' + (sections ? '：' + sections : '')
                    : 'Backup completo importado' + (sections ? '：' + sections : ''),
                result.will_restart ? 'warning' : 'success'
            );
        },

        // ========== Configuração do ambiente ==========

        async loadEnvConfig() {
            this.isLoadingEnv = true;
            try {
                const data = await this.apiRequest('/api/settings/env');
                this.envConfig = {
                    ...this.getEnvDefaults(),
                    ...(data.config || {})
                };
                this.envConfigOriginal = JSON.parse(JSON.stringify(this.envConfig));
            } catch (error) {
                console.error('Falha ao carregar a configuração do ambiente:', error);
                this.envConfig = this.getEnvDefaults();
                this.envConfigOriginal = JSON.parse(JSON.stringify(this.envConfig));
            } finally {
                this.isLoadingEnv = false;
            }
        },

        getEnvDefaults() {
            const defaults = {};
            for (const group of Object.values(ENV_CONFIG_SCHEMA)) {
                for (const [key, field] of Object.entries(group.items)) {
                    defaults[key] = field.default;
                }
            }
            return defaults;
        },

        normalizeEnvCompareValue(value) {
            if (value === undefined || value === null) return '';
            if (typeof value === 'boolean') return value ? 'true' : 'false';
            return String(value);
        },

        getEnvFieldMeta(fieldKey) {
            for (const group of Object.values(ENV_CONFIG_SCHEMA)) {
                if (!group || !group.items || !Object.prototype.hasOwnProperty.call(group.items, fieldKey)) {
                    continue;
                }

                const field = group.items[fieldKey] || {};
                return {
                    ...field,
                    apply: field.apply || group.apply || 'service'
                };
            }

            return null;
        },

        getEnvChangedKeys() {
            const current = this.envConfig || {};
            const original = this.envConfigOriginal || {};
            const keys = new Set([
                ...Object.keys(current),
                ...Object.keys(original)
            ]);

            return Array.from(keys).filter((key) => {
                return this.normalizeEnvCompareValue(current[key]) !== this.normalizeEnvCompareValue(original[key]);
            });
        },

        async saveEnvConfig() {
            this.isSavingEnv = true;
            try {
                const changedKeys = this.getEnvChangedKeys();
                await this.apiRequest('/api/settings/env', {
                    method: 'POST',
                    body: JSON.stringify({ config: this.envConfig })
                });

                this.envConfigOriginal = JSON.parse(JSON.stringify(this.envConfig));
                const launcherKeys = changedKeys.filter((key) => {
                    return (this.getEnvFieldMeta(key)?.apply || 'service') === 'launcher';
                });

                if (launcherKeys.length > 0) {
                    const launcherLabels = launcherKeys.map((key) => {
                        return this.getEnvFieldMeta(key)?.label || key;
                    }).join(', ');

                    this.notify(
                        'Configuração do ambiente salva. O serviço será reiniciado automaticamente, mas para que a configuração de inicialização a seguir tenha efeito total, feche o navegador e o script atuais e execute-os novamente. start.bat：' + launcherLabels,
                        'warning'
                    );
                } else {
                    this.notify('A configuração do ambiente foi salva e entrará em vigor após o serviço ser reiniciado automaticamente.', 'success');
                }
            } catch (error) {
                this.notify('Falha ao salvar: ' + error.message, 'error');
            } finally {
                this.isSavingEnv = false;
            }
        },

        resetEnvConfig() {
            if (!confirm('Tem certeza de que deseja redefinir a configuração do ambiente para o padrão?')) return;

            this.envConfig = this.getEnvDefaults();
            this.notify('Redefinir para o padrão, clique em Salvar para aplicar', 'info');
        },

        // ========== Constantes do navegador ==========

        normalizeBrowserConstantsForEditor(rawConfig = {}) {
            const raw = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
            const normalized = {};

            for (const group of Object.values(BROWSER_CONSTANTS_SCHEMA)) {
                for (const [key, field] of Object.entries(group.items || {})) {
                    normalized[key] = field.default;
                }
            }

            for (const key of Object.keys(normalized)) {
                if (key.startsWith('TAB_POOL_')) {
                    continue;
                }
                if (Object.prototype.hasOwnProperty.call(raw, key)) {
                    normalized[key] = raw[key];
                }
            }

            const tabPool = raw.tab_pool && typeof raw.tab_pool === 'object' ? raw.tab_pool : {};
            normalized.TAB_POOL_MAX_TABS = raw.TAB_POOL_MAX_TABS ?? tabPool.max_tabs ?? normalized.TAB_POOL_MAX_TABS;
            normalized.TAB_POOL_MIN_TABS = raw.TAB_POOL_MIN_TABS ?? tabPool.min_tabs ?? normalized.TAB_POOL_MIN_TABS;
            normalized.TAB_POOL_IDLE_TIMEOUT = raw.TAB_POOL_IDLE_TIMEOUT ?? tabPool.idle_timeout ?? normalized.TAB_POOL_IDLE_TIMEOUT;
            normalized.TAB_POOL_ACQUIRE_TIMEOUT = raw.TAB_POOL_ACQUIRE_TIMEOUT ?? tabPool.acquire_timeout ?? normalized.TAB_POOL_ACQUIRE_TIMEOUT;
            normalized.TAB_POOL_STUCK_TIMEOUT = raw.TAB_POOL_STUCK_TIMEOUT ?? tabPool.stuck_timeout ?? normalized.TAB_POOL_STUCK_TIMEOUT;

            return normalized;
        },

        serializeBrowserConstants(editorConfig = {}, rawBase = {}) {
            const base = rawBase && typeof rawBase === 'object'
                ? JSON.parse(JSON.stringify(rawBase))
                : {};
            const merged = this.normalizeBrowserConstantsForEditor(editorConfig);

            for (const key of Object.keys(merged)) {
                if (key.startsWith('TAB_POOL_')) {
                    continue;
                }
                base[key] = merged[key];
            }

            const existingTabPool = base.tab_pool && typeof base.tab_pool === 'object' ? base.tab_pool : {};
            base.tab_pool = {
                ...existingTabPool,
                max_tabs: merged.TAB_POOL_MAX_TABS,
                min_tabs: merged.TAB_POOL_MIN_TABS,
                idle_timeout: merged.TAB_POOL_IDLE_TIMEOUT,
                acquire_timeout: merged.TAB_POOL_ACQUIRE_TIMEOUT,
                stuck_timeout: merged.TAB_POOL_STUCK_TIMEOUT
            };

            return base;
        },

        async loadBrowserConstants() {
            this.isLoadingConstants = true;
            try {
                const data = await this.apiRequest('/api/settings/browser-constants');
                this.browserConstantsRaw = JSON.parse(JSON.stringify(data.config || {}));
                this.browserConstants = this.normalizeBrowserConstantsForEditor(this.browserConstantsRaw);
                this.browserConstantsOriginal = JSON.parse(JSON.stringify(this.browserConstants));
            } catch (error) {
                console.error('Falha ao carregar constantes do navegador:', error);
                this.browserConstants = this.getBrowserConstantsDefaults();
                this.browserConstantsRaw = this.serializeBrowserConstants(this.browserConstants, {});
                this.browserConstantsOriginal = JSON.parse(JSON.stringify(this.browserConstants));
            } finally {
                this.isLoadingConstants = false;
            }
        },

        getBrowserConstantsDefaults() {
            return this.normalizeBrowserConstantsForEditor({});
        },

        async saveBrowserConstants() {
            this.isSavingConstants = true;
            try {
                const payload = this.serializeBrowserConstants(this.browserConstants, this.browserConstantsRaw);
                await this.apiRequest('/api/settings/browser-constants', {
                    method: 'POST',
                    body: JSON.stringify({ config: payload })
                });

                this.browserConstantsRaw = JSON.parse(JSON.stringify(payload));
                this.browserConstants = this.normalizeBrowserConstantsForEditor(payload);
                this.browserConstantsOriginal = JSON.parse(JSON.stringify(this.browserConstants));
                this.notify('Constantes do navegador salvas', 'success');
            } catch (error) {
                this.notify('Falha ao salvar: ' + error.message, 'error');
            } finally {
                this.isSavingConstants = false;
            }
        },

        resetBrowserConstants() {
            if (!confirm('Tem certeza de que deseja redefinir as constantes do navegador para seus valores padrão?')) return;

            this.browserConstants = this.getBrowserConstantsDefaults();
            this.notify('Redefinir para o padrão, clique em Salvar para aplicar', 'info');
        },

        // ========== Atualizar lista de permissões ==========

        async loadUpdatePreserveSettings() {
            this.isLoadingUpdatePreserve = true;
            try {
                const data = await this.apiRequest('/api/settings/update-preserve');
                this.updatePreserveOptions = Array.isArray(data.options) ? data.options : [];
                this.updatePreserveSelected = Array.isArray(data.selected_patterns) ? data.selected_patterns.slice() : [];
                this.updatePreserveSelectedOriginal = JSON.parse(JSON.stringify(this.updatePreserveSelected));
            } catch (error) {
                console.error('Falha ao carregar a lista de permissões de atualização:', error);
                this.updatePreserveOptions = [];
                this.updatePreserveSelected = [];
                this.updatePreserveSelectedOriginal = [];
            } finally {
                this.isLoadingUpdatePreserve = false;
            }
        },

        toggleUpdatePreserve(pattern) {
            const value = String(pattern || '').trim();
            if (!value) return;
            const next = new Set(this.updatePreserveSelected || []);
            if (next.has(value)) {
                next.delete(value);
            } else {
                next.add(value);
            }
            this.updatePreserveSelected = Array.from(next);
        },

        async saveUpdatePreserveSettings() {
            this.isSavingUpdatePreserve = true;
            try {
                const data = await this.apiRequest('/api/settings/update-preserve', {
                    method: 'POST',
                    body: JSON.stringify({
                        selected_patterns: this.updatePreserveSelected
                    })
                });
                this.updatePreserveSelected = Array.isArray(data.selected_patterns)
                    ? data.selected_patterns.slice()
                    : this.updatePreserveSelected;
                this.updatePreserveSelectedOriginal = JSON.parse(JSON.stringify(this.updatePreserveSelected));
                this.notify('A lista de permissões atualizada foi salva e será atualizada automaticamente na próxima vez.', 'success');
            } catch (error) {
                this.notify('Falha ao salvar: ' + error.message, 'error');
            } finally {
                this.isSavingUpdatePreserve = false;
            }
        },

        resetUpdatePreserveSettings() {
            this.updatePreserveSelected = JSON.parse(JSON.stringify(this.updatePreserveSelectedOriginal));
            this.notify('Revertido para a última lista de permissões atualizada e salva', 'info');
        },

        // ========== Método de gerenciamento de definição de elemento ==========

        async loadSelectorDefinitions() {
            this.isLoadingDefinitions = true;
            try {
                const data = await this.apiRequest('/api/settings/selector-definitions');
                this.selectorDefinitions = data.definitions || DEFAULT_SELECTOR_DEFINITIONS;
                this.selectorDefinitionsOriginal = JSON.parse(JSON.stringify(this.selectorDefinitions));
            } catch (error) {
                console.error('Falha ao carregar a definição do elemento:', error);
                this.selectorDefinitions = JSON.parse(JSON.stringify(DEFAULT_SELECTOR_DEFINITIONS));
                this.selectorDefinitionsOriginal = JSON.parse(JSON.stringify(this.selectorDefinitions));
            } finally {
                this.isLoadingDefinitions = false;
            }
        },

        async saveSelectorDefinitions() {
            this.isSavingDefinitions = true;
            try {
                await this.apiRequest('/api/settings/selector-definitions', {
                    method: 'POST',
                    body: JSON.stringify({ definitions: this.selectorDefinitions })
                });

                this.selectorDefinitionsOriginal = JSON.parse(JSON.stringify(this.selectorDefinitions));
                this.notify('Definição de elemento salva', 'success');
            } catch (error) {
                this.notify('Falha ao salvar: ' + error.message, 'error');
            } finally {
                this.isSavingDefinitions = false;
            }
        },

        async resetSelectorDefinitions() {
            if (!confirm('Tem certeza de que deseja redefinir as definições dos elementos para os valores padrão?')) return;

            try {
                const data = await this.apiRequest('/api/settings/selector-definitions/reset', {
                    method: 'POST'
                });

                this.selectorDefinitions = data.definitions;
                this.selectorDefinitionsOriginal = JSON.parse(JSON.stringify(this.selectorDefinitions));
                this.notify('Redefinir para o padrão', 'success');
            } catch (error) {
                this.notify('Falha na redefinição: ' + error.message, 'error');
            }
        },

        toggleDefinitionEnabled(index) {
            const def = this.selectorDefinitions[index];

            if (def.required) {
                this.notify('Os campos obrigatórios não podem ser desativados', 'warning');
                return;
            }

            def.enabled = !def.enabled;
        },

        openAddDefinitionDialog() {
            this.newDefinition = {
                key: '',
                description: '',
                enabled: true,
                required: false
            };
            this.editingDefinitionIndex = null;
            this.showAddDefinitionDialog = true;
        },

        openEditDefinitionDialog(index) {
            const def = this.selectorDefinitions[index];
            this.newDefinition = { ...def };
            this.editingDefinitionIndex = index;
            this.showAddDefinitionDialog = true;
        },

        saveDefinition() {
            if (!this.newDefinition.key.trim()) {
                this.notify('Insira palavras-chave', 'warning');
                return;
            }

            if (!this.newDefinition.description.trim()) {
                this.notify('Por favor insira uma descrição', 'warning');
                return;
            }

            const key = this.newDefinition.key.trim();
            const existingIndex = this.selectorDefinitions.findIndex(d => d.key === key);

            if (this.editingDefinitionIndex === null) {
                // Novo modo
                if (existingIndex !== -1) {
                    this.notify('A palavra-chave já existe', 'error');
                    return;
                }

                this.selectorDefinitions.push({
                    key: key,
                    description: this.newDefinition.description.trim(),
                    enabled: this.newDefinition.enabled,
                    required: false
                });
            } else {
                // modo de edição
                if (existingIndex !== -1 && existingIndex !== this.editingDefinitionIndex) {
                    this.notify('A palavra-chave já existe', 'error');
                    return;
                }

                this.selectorDefinitions[this.editingDefinitionIndex] = {
                    ...this.selectorDefinitions[this.editingDefinitionIndex],
                    key: key,
                    description: this.newDefinition.description.trim(),
                    enabled: this.newDefinition.enabled
                };
            }

            this.showAddDefinitionDialog = false;
            this.notify('Já adicionado, clique em Salvar para aplicar', 'info');
        },

        removeDefinition(index) {
            const def = this.selectorDefinitions[index];

            if (def.required) {
                this.notify('Os campos obrigatórios não podem ser excluídos', 'warning');
                return;
            }

            if (!confirm('Confirme para excluir "' + def.key + '" ?')) return;

            this.selectorDefinitions.splice(index, 1);
            this.notify('Excluído, clique em Salvar para aplicar', 'info');
        },

        moveDefinition(index, direction) {
            const newIndex = index + direction;
            if (newIndex < 0 || newIndex >= this.selectorDefinitions.length) return;

            const temp = this.selectorDefinitions[index];
            this.selectorDefinitions[index] = this.selectorDefinitions[newIndex];
            this.selectorDefinitions[newIndex] = temp;
        },

        changeTab(tab) {
            if (tab === 'extractors') {
                tab = 'config';
            }
            this.activeTab = tab;
        },

        async ensureTabDataLoaded(tab) {
            if (tab === 'marketplace' && !this.hasLoadedMarketplace) {
                this.hasLoadedMarketplace = true;
                await this.loadMarketplaceCatalog({ silent: true });
                return;
            }
            if (tab === 'settings' && !this.hasLoadedSettings) {
                this.hasLoadedSettings = true;
                await Promise.all([
                    this.loadEnvConfig(),
                    this.loadBrowserConstants(),
                    this.loadUpdatePreserveSettings(),
                    this.loadSelectorDefinitions()
                ]);
                return;
            }
        },

        async loadMarketplaceCatalog({ silent = false, force = false } = {}) {
            this.marketplaceLoading = true;
            this.marketplaceError = '';
            try {
                const suffix = force ? '?refresh=true' : '';
                const data = await this.apiRequest('/api/marketplace' + suffix);
                this.marketplaceCatalog = {
                    items: [],
                    count: 0,
                    total_downloads: 0,
                    default_sort: 'downloads',
                    source_mode: 'local',
                    source_name: 'mercado de alocação',
                    source_url: '',
                    upload_url: '',
                    warning: '',
                    ...(data || {})
                };
                if (!silent) {
                    this.notify('O mercado de plug-ins foi atualizado', 'success');
                }
                return true;
            } catch (error) {
                this.marketplaceError = error.message;
                if (!silent) {
                    this.notify('Falha ao carregar o mercado de plugins: ' + error.message, 'error');
                }
                return false;
            } finally {
                this.marketplaceLoading = false;
            }
        },

        openMarketplace() {
            window.location.href = '/static/marketplace.html';
        },

        openExternalLink(url) {
            const target = String(url || '').trim();
            if (!target) {
                this.notify('Não há links externos para abrir no projeto atual', 'warning');
                return;
            }
            window.open(target, '_blank', 'noopener,noreferrer');
        },

        async previewMarketplaceItem(item) {
            if (!item || !item.id) {
                return;
            }
            try {
                const detail = await this.apiRequest('/api/marketplace/items/' + encodeURIComponent(item.id));
                this.marketplacePreviewTitle = 'prévia do mercado · ' + (detail.name || item.name || item.id);
                this.marketplacePreviewData = detail;
                this.showMarketplacePreview = true;
            } catch (error) {
                this.notify('Falha ao carregar visualização: ' + error.message, 'error');
            }
        },

        copyMarketplacePreview() {
            const payload = JSON.stringify(this.marketplacePreviewData || {}, null, 2);
            navigator.clipboard.writeText(payload)
                .then(() => this.notify('Visualizar conteúdo copiado', 'success'))
                .catch(() => this.notify('Falha na cópia', 'error'));
        },

        saveMarketplacePreview() {
            const payload = JSON.stringify(this.marketplacePreviewData || {}, null, 2);
            this.downloadDataAsJson('marketplace-preview-' + Date.now() + '.json', payload);
            this.notify('Visualização do arquivo exportado', 'success');
        },

        openMarketplaceSubmitDialog() {
            this.resetMarketplaceSubmitForm();
            this.showMarketplaceSubmitDialog = true;
        },

        resetMarketplaceSubmitForm() {
            this.marketplaceSubmitForm = {
                item_type: 'site_config',
                title: this.currentDomain ? (this.currentDomain + ' Postagem de posicionamento') : '',
                summary: '',
                author: 'Postagem principal',
                site_domain: this.currentDomain || '',
                category: this.currentDomain || '',
                preset_name: this.getActivePresetName(),
                compatibility: '',
                version: '1.0.0',
                tagsText: '',
                selected_command_ids: []
            };
        },

        async setMarketplaceSubmitType(itemType) {
            this.marketplaceSubmitForm.item_type = itemType;
            if (itemType === 'command_bundle') {
                if (!this.marketplaceCommandOptions.length) {
                    await this.loadMarketplaceCommandOptions();
                }
                this.marketplaceSubmitForm.title = this.marketplaceSubmitForm.title || 'Instruções de postagem';
                this.marketplaceSubmitForm.category = 'sistema de comando';
            } else {
                this.marketplaceSubmitForm.site_domain = this.marketplaceSubmitForm.site_domain || this.currentDomain || '';
                this.marketplaceSubmitForm.category = this.marketplaceSubmitForm.category || this.marketplaceSubmitForm.site_domain;
                this.marketplaceSubmitForm.preset_name = this.marketplaceSubmitForm.preset_name || this.getActivePresetName();
            }
        },

        async loadMarketplaceCommandOptions() {
            this.marketplaceCommandLoading = true;
            try {
                const data = await this.apiRequest('/api/commands');
                const commands = Array.isArray(data.commands) ? data.commands : [];
                commands.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN'));
                this.marketplaceCommandOptions = commands;
                return commands;
            } catch (error) {
                this.notify('Falha ao carregar a lista de comandos: ' + error.message, 'error');
                return [];
            } finally {
                this.marketplaceCommandLoading = false;
            }
        },

        parseMarketplaceTags(text) {
            return String(text || '')
                .split(/[,\n，]/)
                .map(item => item.trim())
                .filter(Boolean);
        },

        sanitizeCommandForBundle(command) {
            const cloned = JSON.parse(JSON.stringify(command || {}));
            delete cloned.last_triggered;
            delete cloned.trigger_count;
            return cloned;
        },

        getMarketplaceSelectedCommands() {
            const selectedIds = new Set(this.marketplaceSubmitForm.selected_command_ids || []);
            return (this.marketplaceCommandOptions || [])
                .filter(command => selectedIds.has(command.id))
                .map(command => this.sanitizeCommandForBundle(command));
        },

        buildMarketplaceSubmissionPayload() {
            const form = this.marketplaceSubmitForm || {};
            const title = String(form.title || '').trim();
            const summary = String(form.summary || '').trim();
            const author = String(form.author || 'Postagem principal').trim() || 'Postagem principal';
            const category = String(form.category || '').trim();
            const presetName = String(form.preset_name || this.getActivePresetName() || 'predefinição mestre').trim() || 'predefinição mestre';
            const compatibility = String(form.compatibility || '').trim();
            const version = String(form.version || '1.0.0').trim() || '1.0.0';
            const tags = this.parseMarketplaceTags(form.tagsText);

            if (!title) {
                throw new Error('Por favor preencha o título');
            }
            if (!summary) {
                throw new Error('Por favor preencha a introdução');
            }

            if (form.item_type === 'command_bundle') {
                const commands = this.getMarketplaceSelectedCommands();
                if (!commands.length) {
                    throw new Error('Selecione pelo menos um comando');
                }
                return {
                    item_type: 'command_bundle',
                    title,
                    summary,
                    author,
                    category: category || 'sistema de comando',
                    compatibility,
                    version,
                    tags,
                    command_bundle: {
                        group_name: '',
                        commands
                    }
                };
            }

            const siteDomain = String(form.site_domain || this.currentDomain || '').trim();
            if (!siteDomain) {
                throw new Error('Por favor preencha o nome de domínio do site');
            }
            const presetConfig = this.getActivePresetConfig();
            if (!presetConfig) {
                throw new Error('No momento não há configurações de site disponíveis para upload');
            }

            return {
                item_type: 'site_config',
                title,
                summary,
                author,
                category: category || siteDomain,
                site_domain: siteDomain,
                preset_name: presetName,
                compatibility,
                version,
                tags,
                site_config: {
                    [siteDomain]: {
                        default_preset: presetName,
                        presets: {
                            [presetName]: JSON.parse(JSON.stringify(presetConfig))
                        }
                    }
                }
            };
        },

        getMarketplaceSubmissionPreviewText() {
            try {
                return JSON.stringify(this.buildMarketplaceSubmissionPayload(), null, 2);
            } catch (error) {
                return '// A visualização ainda não está disponível: ' + error.message;
            }
        },

        async submitMarketplaceItem() {
            let payload = null;
            try {
                payload = this.buildMarketplaceSubmissionPayload();
            } catch (error) {
                this.notify(error.message, 'warning');
                return;
            }

            this.marketplaceSubmitSaving = true;
            try {
                await this.apiRequest('/api/marketplace/items', {
                    method: 'POST',
                    body: JSON.stringify(payload)
                });
                this.showMarketplaceSubmitDialog = false;
                this.activeTab = 'marketplace';
                this.hasLoadedMarketplace = true;
                await this.loadMarketplaceCatalog({ silent: true, force: true });
                this.notify('O envio foi adicionado ao mercado local', 'success');
            } catch (error) {
                this.notify('Falha no envio: ' + error.message, 'error');
            } finally {
                this.marketplaceSubmitSaving = false;
            }
        },

        async startMarketplaceImport(item) {
            if (!item || !item.id) {
                return;
            }

            this.marketplaceImportingId = item.id;
            try {
                const detail = await this.apiRequest('/api/marketplace/items/' + encodeURIComponent(item.id));
                if (detail.item_type === 'command_bundle') {
                    await this.importMarketplaceCommandBundle(detail);
                    return;
                }

                this.marketplacePendingImport = detail;
                this.marketplaceImportStrategy = 'overwrite';
                this.marketplaceImportPresetName = (detail.name || detail.preset_name || 'inadimplência de mercado').trim();
                this.showMarketplaceImportDialog = true;
            } catch (error) {
                this.notify('Falha ao carregar conteúdo importado: ' + error.message, 'error');
            } finally {
                this.marketplaceImportingId = null;
            }
        },

        async confirmMarketplaceImport() {
            if (!this.marketplacePendingImport) {
                return;
            }

            try {
                if (this.marketplaceImportStrategy === 'save_as_preset') {
                    await this.applyMarketplaceSiteSaveAsPreset();
                } else {
                    await this.applyMarketplaceSiteOverwrite();
                }
                this.showMarketplaceImportDialog = false;
                this.marketplacePendingImport = null;
                this.activeTab = 'config';
            } catch (error) {
                this.notify('Falha na importação: ' + error.message, 'error');
            }
        },

        getSingleImportedSite(detail) {
            const siteConfig = detail && detail.site_config;
            if (!this.validateImportedConfig(siteConfig)) {
                throw new Error('O formato de configuração do mercado é inválido');
            }

            const domains = Object.keys(siteConfig || {});
            if (domains.length !== 1) {
                throw new Error('Atualmente, apenas a importação de configuração de site único é suportada');
            }

            const domain = domains[0];
            const normalizedMap = this.normalizeConfig(siteConfig);
            const normalizedSite = normalizedMap[domain];
            if (!normalizedSite) {
                throw new Error('Falha na análise da configuração do site');
            }

            return { domain, site: normalizedSite };
        },

        async applyMarketplaceSiteOverwrite() {
            const imported = this.getSingleImportedSite(this.marketplacePendingImport);
            this.sites[imported.domain] = imported.site;
            this.currentDomain = imported.domain;
            await this.apiRequest('/api/config', {
                method: 'POST',
                body: JSON.stringify({ config: this.sites })
            });
            this.notify('A configuração do site foi substituída e importada: ' + imported.domain, 'success');
        },

        async applyMarketplaceSiteSaveAsPreset() {
            const imported = this.getSingleImportedSite(this.marketplacePendingImport);
            const newPresetName = String(this.marketplaceImportPresetName || '').trim();
            if (!newPresetName) {
                throw new Error('Preencha e salve como nome padrão');
            }

            const targetSite = this.sites[imported.domain]
                ? JSON.parse(JSON.stringify(this.sites[imported.domain]))
                : { default_preset: newPresetName, presets: {} };

            if (targetSite.presets && targetSite.presets[newPresetName]) {
                throw new Error('O nome padrão já existe, altere-o para um nome diferente');
            }

            const importedPresets = imported.site.presets || {};
            const sourcePresetName = imported.site.default_preset && importedPresets[imported.site.default_preset]
                ? imported.site.default_preset
                : Object.keys(importedPresets)[0];
            if (!sourcePresetName) {
                throw new Error('O conteúdo importado não contém predefinições');
            }

            targetSite.presets = targetSite.presets || {};
            targetSite.presets[newPresetName] = JSON.parse(JSON.stringify(importedPresets[sourcePresetName]));
            targetSite.default_preset = targetSite.default_preset || newPresetName;
            this.sites[imported.domain] = targetSite;
            this.currentDomain = imported.domain;

            await this.apiRequest('/api/config', {
                method: 'POST',
                body: JSON.stringify({ config: this.sites })
            });
            this.notify('Configuração do site salva como predefinida: ' + newPresetName, 'success');
        },

        prepareCommandImportPayload(command) {
            const cloned = JSON.parse(JSON.stringify(command || {}));
            delete cloned.id;
            delete cloned.last_triggered;
            delete cloned.trigger_count;
            return cloned;
        },

        async importMarketplaceCommandBundle(detail) {
            const bundle = detail && detail.command_bundle;
            const commands = Array.isArray(bundle && bundle.commands) ? bundle.commands : [];
            if (!commands.length) {
                throw new Error('O pacote de comandos está vazio');
            }

            const idMap = {};
            const importedCommands = [];

            for (const command of commands) {
                const oldId = command.id;
                const payload = this.prepareCommandImportPayload(command);
                const response = await this.apiRequest('/api/commands', {
                    method: 'POST',
                    body: JSON.stringify(payload)
                });
                const created = response.command;
                importedCommands.push(created);
                if (oldId && created && created.id) {
                    idMap[oldId] = created.id;
                }
            }

            for (let index = 0; index < commands.length; index++) {
                const original = commands[index];
                const created = importedCommands[index];
                if (!original || !created || !original.trigger) {
                    continue;
                }

                const trigger = JSON.parse(JSON.stringify(original.trigger));
                if (trigger.command_id && idMap[trigger.command_id]) {
                    trigger.command_id = idMap[trigger.command_id];
                }
                if (Array.isArray(trigger.command_ids)) {
                    trigger.command_ids = trigger.command_ids.map(commandId => idMap[commandId] || commandId);
                }

                await this.apiRequest('/api/commands/' + encodeURIComponent(created.id), {
                    method: 'PUT',
                    body: JSON.stringify({ trigger })
                });
            }

            this.notify('O pacote de comando foi importado, um total de ' + importedCommands.length + ' comando', 'success');
        },

        downloadDataAsJson(filename, payloadText) {
            const blob = new Blob([payloadText], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            link.click();
            URL.revokeObjectURL(url);
        },

        // ========== Método auxiliar padrão ==========

        getActivePresetName() {
            try {
                if (this.$refs.configTab && this.$refs.configTab.selectedPreset) {
                    return this.$refs.configTab.selectedPreset
                }
            } catch (e) { }
            const presets = this.currentConfig && this.currentConfig.presets
            if (presets && typeof presets === 'object') {
                const configuredDefault = this.currentConfig.default_preset
                if (configuredDefault && presets[configuredDefault]) {
                    return configuredDefault
                }
                if (presets['predefinição mestre']) {
                    return 'predefinição mestre'
                }
                const keys = Object.keys(presets)
                if (keys.length > 0) {
                    return keys[0]
                }
            }
            return 'predefinição mestre'
        },

        getActivePresetConfig() {
            if (!this.currentConfig) return null
            const presets = this.currentConfig.presets
            if (!presets) return this.currentConfig
            const name = this.getActivePresetName()
            const configuredDefault = this.currentConfig.default_preset
            return presets[name]
                || (configuredDefault ? presets[configuredDefault] : null)
                || presets['predefinição mestre']
                || Object.values(presets)[0]
                || null
        },

        // ========== Operações de dados ==========

        normalizeConfig(raw) {
            const norm = {}
            // Lista de campos dentro da predefinição (usada para limpar resíduos de nível superior)
            const PRESET_FIELDS = [
                'selectors', 'workflow', 'stealth', 'stream_config',
                'image_extraction', 'file_paste',
                'extractor_id', 'extractor_verified'
            ]
            for (const [k, v] of Object.entries(raw || {})) {
                if (v.presets) {
                    // Novo formato: mantido presets Estrutura, garantindo que cada predefinição tenha campos básicos
                    const normalizedPresets = {}
                    for (const [presetName, presetData] of Object.entries(v.presets)) {
                        normalizedPresets[presetName] = {
                            ...presetData,
                            selectors: presetData.selectors || {},
                            workflow: presetData.workflow || [],
                            stealth: !!presetData.stealth
                        }
                    }
                    const presetKeys = Object.keys(normalizedPresets)
                    const configuredDefault = typeof v.default_preset === 'string'
                        ? v.default_preset
                        : null
                    const resolvedDefault = (configuredDefault && normalizedPresets[configuredDefault])
                        ? configuredDefault
                        : (normalizedPresets['predefinição mestre'] ? 'predefinição mestre' : (presetKeys[0] || 'predefinição mestre'))
                    // Crie o objeto do site e mantenha apenas presets, limpe os campos restantes fora da predefinição
                    const siteObj = {
                        presets: normalizedPresets,
                        default_preset: resolvedDefault
                    }
                    // Preservar campos não padrão (como possíveis futuros metadados no nível do site)
                    for (const [field, value] of Object.entries(v)) {
                        if (field !== 'presets' && field !== 'default_preset' && !PRESET_FIELDS.includes(field)) {
                            siteObj[field] = value
                        }
                    }
                    norm[k] = siteObj
                } else {
                    // Compatibilidade com formatos antigos: o empacotamento é padrão (não deve aparecer novamente após a migração de back-end, mas é seguro)
                    norm[k] = {
                        default_preset: 'predefinição mestre',
                        presets: {
                            'predefinição mestre': {
                                ...v,
                                selectors: v.selectors || {},
                                workflow: v.workflow || [],
                                stealth: !!v.stealth
                            }
                        }
                    }
                }
            }
            return norm
        },

        validateConfig() {
            if (!this.currentDomain || !this.currentConfig) {
                this.notify('Selecione um site', 'warning')
                return false
            }

            // Obtenha a configuração da predefinição atualmente ativa
            const presetConfig = this.getActivePresetConfig()
            if (!presetConfig) {
                this.notify('Não foi possível obter a configuração padrão', 'error')
                return false
            }

            const selectors = presetConfig.selectors || {}
            const workflow = presetConfig.workflow || []
            const hasSelectorActions = workflow.some(step => ['FILL_INPUT', 'CLICK', 'STREAM_WAIT'].includes(step.action))
            if (hasSelectorActions && Object.keys(selectors).length === 0) {
                this.notify('É necessário pelo menos um seletor', 'warning')
                return false
            }

            for (let i = 0; i < workflow.length; i++) {
                const step = workflow[i]

                if (!step.action) {
                    this.notify('etapa ' + (i + 1) + ': Tipo de ação ausente', 'error')
                    return false
                }

                if (['FILL_INPUT', 'CLICK', 'STREAM_WAIT'].includes(step.action)) {
                    if (!step.target) {
                        this.notify('etapa ' + (i + 1) + ': Selecione um seletor de destino', 'error')
                        return false
                    }
                }

                if (step.action === 'COORD_CLICK') {
                    const x = Number(step.value?.x)
                    const y = Number(step.value?.y)
                    if (!Number.isFinite(x) || !Number.isFinite(y)) {
                        this.notify('etapa ' + (i + 1) + ': Por favor insira um válido X/Y coordenada', 'error')
                        return false
                    }
                }

                if (step.action === 'KEY_PRESS' && !step.target) {
                    this.notify('etapa ' + (i + 1) + ': Por favor insira o nome da chave', 'error')
                    return false
                }

                if (step.action === 'WAIT' && (!step.value || step.value <= 0)) {
                    this.notify('etapa ' + (i + 1) + ': O tempo de espera deve ser maior que 0', 'error')
                    return false
                }
            }

            for (let i = 0; i < workflow.length; i++) {
                const step = workflow[i]
                if (step.action === 'JS_EXEC' && !String(step.value || '').trim()) {
                    this.notify('etapa ' + (i + 1) + ': Por favor insira JavaScript código', 'error')
                    return false
                }
            }

            return true
        },

        selectSite(domain) {
            this.currentDomain = domain
        },

        addNewSite() {
            const domain = prompt('Por favor, insira um nome de domínio (por exemplo,: chat.example.com）:')
            if (!domain) return

            if (this.sites[domain]) {
                this.notify('O site já existe', 'warning')
                this.currentDomain = domain
                return
            }

            this.sites[domain] = {
                default_preset: 'predefinição mestre',
                presets: {
                    'predefinição mestre': {
                        selectors: {},
                        workflow: [],
                        stealth: false
                    }
                }
            }
            this.currentDomain = domain
            this.notify('Site criado: ' + domain, 'success')
        },

        confirmDelete(domain) {
            if (!confirm('Confirme para excluir ' + domain + ' configuração?')) {
                return
            }

            delete this.sites[domain]

            if (this.currentDomain === domain) {
                this.currentDomain = Object.keys(this.sites)[0] || null
            }

            this.notify('Excluído: ' + domain, 'info')
        },

        // ========== Operações do seletor ==========

        addSelector(preset) {
            this.showSelectorMenu = false
            const pc = this.getActivePresetConfig()
            if (!pc) return

            let key
            if (preset === 'custom') {
                key = prompt('Insira um nome de seletor (por exemplo,: input_box）')
                if (!key) return
            } else {
                key = preset
            }

            if (pc.selectors[key]) {
                this.notify('seletor "' + key + '" Já existe', 'warning')
                return
            }

            pc.selectors[key] = ''
            this.notify('Seletor adicionado: ' + key, 'success')
        },

        removeSelector(key) {
            if (!confirm('OK para excluir o seletor ' + key + ' ?')) {
                return
            }

            const pc = this.getActivePresetConfig()
            if (!pc) return

            delete pc.selectors[key]

                ; (pc.workflow || []).forEach(function (step) {
                    if (step.target === key) {
                        step.target = ''
                    }
                })
        },

        updateSelectorKey(oldKey, newKey) {
            if (!newKey || oldKey === newKey) return

            newKey = newKey.trim()

            const pc = this.getActivePresetConfig()
            if (!pc) return

            if (pc.selectors[newKey]) {
                this.notify('O nome da chave já existe', 'error')
                return
            }

            pc.selectors[newKey] = pc.selectors[oldKey]
            delete pc.selectors[oldKey]

                ; (pc.workflow || []).forEach(function (step) {
                    if (step.target === oldKey) {
                        step.target = newKey
                    }
                })
        },

        // ========== Operações de fluxo de trabalho ==========

        addStep() {
            const pc = this.getActivePresetConfig()
            if (!pc) return

            const defaultStep = {
                action: 'CLICK',
                target: '',
                optional: false,
                value: null
            }

            if (!pc.workflow) pc.workflow = []
            pc.workflow.push(defaultStep)
        },

        removeStep(index) {
            const pc = this.getActivePresetConfig()
            if (!pc || !pc.workflow) return

            pc.workflow.splice(index, 1)
        },

        moveStep(index, direction) {
            const pc = this.getActivePresetConfig()
            if (!pc || !pc.workflow) return

            const arr = pc.workflow
            const newIndex = index + direction

            if (newIndex < 0 || newIndex >= arr.length) return

            const temp = arr[index]
            arr[index] = arr[newIndex]
            arr[newIndex] = temp
        },

        onActionChange(step) {
            if (['FILL_INPUT', 'CLICK', 'STREAM_WAIT'].includes(step.action)) {
                step.value = null
                if (!step.target) step.target = ''
            } else if (step.action === 'COORD_CLICK') {
                step.target = ''
                step.value = {
                    x: Number(step.value?.x ?? 0),
                    y: Number(step.value?.y ?? 0),
                    random_radius: Number(step.value?.random_radius ?? 10)
                }
            } else if (step.action === 'KEY_PRESS') {
                step.value = null
                if (!step.target) step.target = 'Enter'
            } else if (step.action === 'JS_EXEC') {
                step.target = ''
                if (!String(step.value || '').trim()) step.value = 'return document.title;'
            } else if (step.action === 'WAIT') {
                step.target = ''
                if (!step.value) step.value = '1.0'
            }
        },

        showTemplates() {
            this.showStepTemplates = true
        },

        applyTemplate(type) {
            const templates = {
                'default': [
                    { action: 'CLICK', target: 'new_chat_btn', optional: true, value: null },
                    { action: 'WAIT', target: '', optional: false, value: '0.5' },
                    { action: 'FILL_INPUT', target: 'input_box', optional: false, value: null },
                    { action: 'CLICK', target: 'send_btn', optional: true, value: null },
                    { action: 'KEY_PRESS', target: 'Enter', optional: true, value: null },
                    { action: 'STREAM_WAIT', target: 'result_container', optional: false, value: null }
                ],
                'simple': [
                    { action: 'FILL_INPUT', target: 'input_box', optional: false, value: null },
                    { action: 'KEY_PRESS', target: 'Enter', optional: false, value: null },
                    { action: 'STREAM_WAIT', target: 'result_container', optional: false, value: null }
                ]
            }

            if (!confirm('Isso substituirá a configuração atual do fluxo de trabalho. Tem certeza de que deseja continuar?')) {
                return
            }

            const pc = this.getActivePresetConfig()
            if (!pc) return
            pc.workflow = JSON.parse(JSON.stringify(templates[type]))
            this.showStepTemplates = false
            this.notify('O modelo foi aplicado', 'success')
        },

        // ========== Função da ferramenta ==========

        copyJson(textOverride) {
            const text = typeof textOverride === 'string'
                ? textOverride
                : JSON.stringify(this.getJsonPreviewData(), null, 2)
            navigator.clipboard.writeText(text).then(() => {
                this.notify('Copiado para a área de transferência', 'success')
            }).catch(() => {
                this.notify('Falha na cópia', 'error')
            })
        },

        getJsonPreviewData() {
            const config = this.getActivePresetConfig() || {}
            return JSON.parse(JSON.stringify(config))
        },

        async saveJsonPreview(rawText) {
            if (!this.currentDomain) {
                this.notify('Selecione um site primeiro', 'warning')
                return
            }

            let parsed
            try {
                parsed = JSON.parse(rawText)
            } catch (error) {
                this.notify('JSON Falha na análise: ' + error.message, 'error')
                return
            }

            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                this.notify('JSON O nível superior deve ser um objeto', 'error')
                return
            }

            if (parsed.selectors !== undefined && (typeof parsed.selectors !== 'object' || Array.isArray(parsed.selectors))) {
                this.notify('selectors Deve ser um objeto', 'error')
                return
            }

            if (parsed.workflow !== undefined && !Array.isArray(parsed.workflow)) {
                this.notify('workflow Deve ser uma matriz', 'error')
                return
            }

            if (parsed.presets && typeof parsed.presets === 'object' && !Array.isArray(parsed.presets)) {
                const normalized = this.normalizeConfig({ [this.currentDomain]: parsed })
                if (normalized[this.currentDomain]) {
                    this.sites[this.currentDomain] = normalized[this.currentDomain]
                }

                try {
                    await this.apiRequest('/api/config', {
                        method: 'POST',
                        body: JSON.stringify({ config: this.sites })
                    })
                    this.showJsonPreview = false
                    this.notify('site JSON salvo', 'success')
                } catch (error) {
                    this.notify('Falha ao salvar: ' + error.message, 'error')
                }
                return
            }

            const site = JSON.parse(JSON.stringify(this.sites[this.currentDomain] || {}))
            const presets = site.presets || { 'predefinição mestre': {} }
            const presetName = this.getActivePresetName()
            const currentPreset = presets[presetName] || presets['predefinição mestre'] || {}
            const { domain, preset_name, timestamp, ...presetPatch } = parsed

            presets[presetName] = {
                ...currentPreset,
                ...presetPatch,
                selectors: presetPatch.selectors !== undefined ? presetPatch.selectors : (currentPreset.selectors || {}),
                workflow: presetPatch.workflow !== undefined ? presetPatch.workflow : (currentPreset.workflow || []),
                stealth: presetPatch.stealth !== undefined ? !!presetPatch.stealth : !!currentPreset.stealth
            }

            site.presets = presets
            if (!site.default_preset || !site.presets[site.default_preset]) {
                site.default_preset = site.presets['predefinição mestre'] ? 'predefinição mestre' : (Object.keys(site.presets)[0] || 'predefinição mestre')
            }
            this.sites[this.currentDomain] = site

            try {
                await this.apiRequest('/api/config', {
                    method: 'POST',
                    body: JSON.stringify({ config: this.sites })
                })
                this.showJsonPreview = false
                this.notify('JSON Alterações salvas', 'success')
            } catch (error) {
                this.notify('Falha ao salvar: ' + error.message, 'error')
            }
        },

        saveToken() {
            if (this.tempToken.trim()) {
                localStorage.setItem('api_token', this.tempToken.trim())
                this.notify('Token salvo', 'success')
            } else {
                localStorage.removeItem('api_token')
                this.notify('Token limpo', 'info')
            }

            this.showTokenDialog = false
            this.tempToken = ''

            this.loadConfig(true)
        },

        // ========== Toast notificar ==========

        notify(message, type) {
            if (!type) type = 'info'
            const id = this.toastCounter++
            this.toasts.push({ id: id, message: message, type: type })

            const self = this
            setTimeout(function () {
                self.removeToast(id)
            }, 3000)
        },

        removeToast(id) {
            this.toasts = this.toasts.filter(function (t) {
                return t.id !== id
            })
        }
    }
});

// ========== Registro de componentes ==========
app.component('sidebar-component', window.SidebarComponent);
app.component('config-tab', window.ConfigTab);
app.component('marketplace-tab', window.MarketplaceTab);
app.component('tabpool-tab', window.TabPoolTabComponent);
app.component('commands-tab', window.CommandsTabComponent);  // 🆕 sistema de comando
app.component('logs-tab', window.LogsTab);
app.component('settings-tab', window.SettingsTab);
app.component('json-preview-dialog', window.JsonPreviewDialog);
app.component('token-dialog', window.TokenDialog);
app.component('step-templates-dialog', window.StepTemplatesDialog);
app.component('test-dialog', window.TestDialog);
app.component('import-dialog', window.ImportDialog);
app.component('definition-dialog', window.DefinitionDialog);

// ========== situação geral Mixin (Corrigir problema de acesso ao ícone) ==========
app.mixin({
    computed: {
        $icons() {
            return window.$icons || window.icons || {};
        }
    }
});

// ========== Iniciar aplicativo ==========
app.mount('#app');
document.body.classList.add('app-mounted');
const appShell = document.getElementById('app-shell');
if (appShell) {
    appShell.style.display = 'none';
}
