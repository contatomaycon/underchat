/**
 * Editor visual de fluxo de trabalho v2.0 - Versão simples  * Recurso: Carregar automaticamente a configuração + posicionamento do elemento + minimalista UI
 */
(function() {
  'use strict';
  
  if (window.__WORKFLOW_EDITOR_INJECTED__) {
    console.log('[WorkflowEditor] Existe, reexibir');
    window.WorkflowEditor?.show?.();
    return;
  }
  window.__WORKFLOW_EDITOR_INJECTED__ = true;
  
    // ========== Configuração ==========
    const TYPES = {
        COORD_CLICK: { color: 'rgba(249, 115, 22, 0.18)', border: '#F97316', name: 'Coord Click' },
        CLICK: { color: 'rgba(59, 130, 246, 0.15)', border: '#3B82F6', name: 'Clique' },
        INPUT: { color: 'rgba(16, 185, 129, 0.15)', border: '#10B981', name: 'digitar' },
        READ: { color: 'rgba(139, 92, 246, 0.15)', border: '#8B5CF6', name: 'ler' }
    };

    // 🔧 extremidade traseira API Endereço (transmitido desde o momento da injeção ou use o valor padrão)     const BALL_SIZE = 32;
    const BALL_RADIUS = BALL_SIZE / 2;
    const API_BASE = window.__WORKFLOW_EDITOR_API_BASE__ || 'http://127.0.0.1:9099';

    const state = {
        steps: [],
        siteConfig: null,
        presetName: null,
        isPickingElement: false,
        pickingCallback: null,
        isVisible: true
    };
  
  // ========== estilo ==========
  function injectStyles() {
    if (document.getElementById('wfe-styles')) return;
    const style = document.createElement('style');
    style.id = 'wfe-styles';
    style.textContent = `
      .wfe-ball {
        position: fixed;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: grab;
        z-index: 2147483640;
        border: 2px solid;
        transition: all 0.2s;
        font-family: system-ui, -apple-system, sans-serif;
        font-size: 13px;
        font-weight: 700;
      }
      .wfe-ball:hover { transform: scale(1.15); box-shadow: 0 0 12px rgba(0,0,0,0.2); }
      .wfe-ball.dragging { cursor: grabbing; transform: scale(1.2); }
      .wfe-ball.read-type { cursor: pointer; }
      .wfe-ball.warning {
        border-color: #dc2626 !important;
        background: rgba(220, 38, 38, 0.15) !important;
        animation: wfe-pulse 1.5s ease-in-out infinite;
      }
      .wfe-ball.warning::after {
        content: '⚠';
        position: absolute;
        top: -8px;
        right: -8px;
        font-size: 12px;
        background: #dc2626;
        color: white;
        border-radius: 50%;
        width: 16px;
        height: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      @keyframes wfe-pulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(220, 38, 38, 0.4); }
        50% { box-shadow: 0 0 0 6px rgba(220, 38, 38, 0); }
      }

      .wfe-menu {
        position: fixed;
        background: white;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        box-shadow: 0 10px 40px rgba(0,0,0,0.15);
        z-index: 2147483645;
        min-width: 280px;
        font-family: system-ui, sans-serif;
        font-size: 13px;
        animation: wfe-fade 0.15s;
      }
      @keyframes wfe-fade { from { opacity: 0; transform: translateY(-4px); } }
      
      .wfe-menu-header {
        padding: 12px 14px;
        border-bottom: 1px solid #f3f4f6;
        background: #f9fafb;
      }
      .wfe-menu-title { font-weight: 600; font-size: 13px; color: #111827; }
      .wfe-menu-subtitle { font-size: 11px; color: #6b7280; margin-top: 2px; }
      
      .wfe-menu-body { padding: 6px 0; }
      .wfe-menu-item {
        padding: 8px 14px;
        display: flex;
        align-items: center;
        gap: 10px;
        transition: background 0.1s;
      }
      .wfe-menu-item:hover:not(.disabled) { background: #f9fafb; }
      .wfe-menu-item.disabled { opacity: 0.5; }
      .wfe-menu-item.clickable { cursor: pointer; }
      
      .wfe-menu-label { flex: 1; font-size: 12px; color: #374151; }
      .wfe-menu-input {
        border: 1px solid #d1d5db;
        border-radius: 4px;
        padding: 4px 8px;
        font-size: 12px;
        width: 70px;
        text-align: center;
      }
      .wfe-menu-input:focus { outline: none; border-color: #3b82f6; }
      .wfe-menu-input.wide { width: 140px; text-align: left; }
      
      .wfe-divider { height: 1px; background: #f3f4f6; margin: 4px 0; }
      .wfe-menu-item.danger { color: #dc2626; }
      .wfe-menu-item.danger:hover { background: #fef2f2; }
      
      .wfe-toolbar {
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: white;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        padding: 8px;
        z-index: 2147483638;
        display: flex;
        gap: 6px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.1);
        font-family: system-ui, sans-serif;
      }
      
      .wfe-btn {
        padding: 6px 10px;
        border: 1px solid #e5e7eb;
        border-radius: 6px;
        background: white;
        cursor: pointer;
        font-size: 11px;
        font-weight: 500;
        transition: all 0.15s;
        color: #374151;
      }
      .wfe-btn:hover { background: #f9fafb; border-color: #d1d5db; transform: translateY(-1px); }
      .wfe-btn:active { transform: translateY(0); }
      .wfe-btn.primary { background: #3b82f6; color: white; border-color: #3b82f6; }
      .wfe-btn.primary:hover { background: #2563eb; }
      .wfe-btn.danger { color: #dc2626; }
      .wfe-btn.danger:hover { background: #fef2f2; }
      
      .wfe-pick-overlay {
        position: fixed;
        inset: 0;
        z-index: 2147483642;
        cursor: crosshair;
        background: rgba(0,0,0,0.02);
      }
      .wfe-highlight {
        outline: 2px solid #8b5cf6 !important;
        outline-offset: 2px !important;
        background: rgba(139,92,246,0.1) !important;
      }
      .wfe-pick-tip {
        position: fixed;
        top: 16px;
        left: 50%;
        transform: translateX(-50%);
        background: #8b5cf6;
        color: white;
        padding: 10px 20px;
        border-radius: 6px;
        font-size: 13px;
        font-weight: 500;
        z-index: 2147483646;
        box-shadow: 0 4px 16px rgba(139,92,246,0.3);
      }
      
      .wfe-hidden { display: none !important; }
    `;
    document.head.appendChild(style);
  }
  
  // ========== DOM ferramenta ==========
  function el(tag, props = {}, children = []) {
    const element = document.createElement(tag);
    Object.entries(props).forEach(([k, v]) => {
      if (k === 'className') element.className = v;
      else if (k === 'style') Object.assign(element.style, v);
      else if (k.startsWith('data-')) element.setAttribute(k, v);
      else element[k] = v;
    });
    children.forEach(c => element.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
    return element;
  }
  
  function findElement(selector) {
    if (!selector) return null;
    try {
      const elements = document.querySelectorAll(selector);
      return elements.length > 0 ? elements[elements.length - 1] : null;
    } catch {
      return null;
    }
  }
  
  function getElementCenter(element) {
    if (!element) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const rect = element.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };
  }
  
  function generateSelector(element) {
    if (!element || element === document.body) return 'body';
    
    if (element.id && !element.id.startsWith('wfe-')) {
      const sel = '#' + CSS.escape(element.id);
      if (document.querySelectorAll(sel).length === 1) return sel;
    }
    
    const testId = element.getAttribute('data-testid');
    if (testId) {
      const sel = `[data-testid="${testId}"]`;
      if (document.querySelectorAll(sel).length === 1) return sel;
    }
    
    if (element.className && typeof element.className === 'string') {
      const classes = element.className.split(' ')
        .filter(c => c && !c.startsWith('wfe-'))
        .slice(0, 2);
      if (classes.length > 0) {
        const sel = element.tagName.toLowerCase() + '.' + classes.join('.');
        if (document.querySelectorAll(sel).length === 1) return sel;
      }
    }
    
    return element.tagName.toLowerCase();
  }

  function normalizeKey(value) {
    return String(value || '')
      .trim()
      .replace(/[^\w\u4e00-\u9fa5-]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  function findSelectorKeyByValue(selectors, selector) {
    if (!selector) return '';
    for (const [key, value] of Object.entries(selectors || {})) {
      if (value === selector) return key;
    }
    return '';
  }

  function generateTargetKey(type, selectors, preferred) {
    const used = selectors || {};
    const normalizedPreferred = normalizeKey(preferred);
    if (normalizedPreferred) {
      return normalizedPreferred;
    }

    const base =
      type === 'INPUT' ? 'input_box' :
      type === 'READ' ? 'result_container' :
      'click_target';

    if (!used[base]) {
      return base;
    }

    let index = 1;
    while (used[`${base}_${index}`]) {
      index += 1;
    }
    return `${base}_${index}`;
  }

  function ensureBallTargetKey(ball, selectors) {
    if (!ball.config.selector) {
      return ball.config.targetKey || '';
    }

    const existingKey = findSelectorKeyByValue(selectors, ball.config.selector);
    if (existingKey) {
      ball.config.targetKey = existingKey;
      return existingKey;
    }

    const resolvedKey = generateTargetKey(ball.type, selectors, ball.config.targetKey);
    ball.config.targetKey = resolvedKey;
    selectors[resolvedKey] = ball.config.selector;
    return resolvedKey;
  }
  
  // ========== Bolas pequenas ==========
    class Ball {
        constructor(opts) {
            this.id = 'b' + Date.now() + Math.random().toString(36).slice(2, 7);
            this.type = opts.type;
            this.seq = opts.seq;
            this.x = opts.x ?? 100;
            this.y = opts.y ?? 100;
            this.config = {
                delay_ms: opts.seq === 1 ? 0 : 1000,
                random_radius: 10,
                text: '',
                selector: '',
                targetKey: '',
                optional: false,
                ...opts.config
            };

            this.element = null;
            this.isDragging = false;
            this.offset = { x: 0, y: 0 };
            this.isWarning = false;       // estado de aviso             this.warningMessage = '';     // mensagem de aviso              this.render();
            this.bind();

            // Não posicionado automaticamente no construtor, por addBall Processamento unificado         }
    
      render() {
          const tc = TYPES[this.type];
          const selectorHint = this.config.selector ? ` → ${this.config.selector.slice(0, 30)}` : '';
          this.element = el('div', {
              className: 'wfe-ball' + (this.type === 'READ' ? ' read-type' : ''),
              style: {
                  background: tc.color,
                  borderColor: tc.border,
                  color: tc.border,
                  left: this.x + 'px',
                  top: this.y + 'px'
              },
              'data-ball-id': this.id,
              title: `#${this.seq} ${tc.name}${selectorHint}`
          }, [String(this.seq)]);

          document.body.appendChild(this.element);
      }
    
    bind() {
      this.element.addEventListener('mousedown', (e) => {
        if (e.button !== 0 || this.type === 'READ') return;
        this.isDragging = true;
        this.element.classList.add('dragging');
        this.offset = { x: e.clientX - this.x, y: e.clientY - this.y };
        e.preventDefault();
        e.stopPropagation();
      });
      
      this.element.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showMenu(this, e.clientX, e.clientY);
      });
      
      if (this.type === 'READ') {
        this.element.addEventListener('click', () => {
          startPicker(this);
        });
      }
    }
    
    move(x, y) {
      this.x = Math.max(0, Math.min(window.innerWidth - BALL_SIZE, x));
      this.y = Math.max(0, Math.min(window.innerHeight - BALL_SIZE, y));
      this.element.style.left = this.x + 'px';
      this.element.style.top = this.y + 'px';
    }
    
      updateSeq(n) {
          this.seq = n;
          this.element.textContent = String(n);
          const selectorHint = this.config.selector ? ` → ${this.config.selector.slice(0, 30)}` : '';
          this.element.title = `#${n} ${TYPES[this.type].name}${selectorHint}`;
          if (n === 1) this.config.delay_ms = 0;
      }
    
    locateToElement() {
      const target = findElement(this.config.selector);
      if (target) {
        const pos = getElementCenter(target);
        this.move(pos.x - BALL_RADIUS, pos.y - BALL_RADIUS);
      }
    }

        setWarning(message) {
            this.isWarning = true;
            this.warningMessage = message;
            this.element?.classList.add('warning');
            // renovar title Mostrar mensagem de aviso             const tc = TYPES[this.type];
            this.element.title = `⚠️ #${this.seq} ${tc.name} - ${message}`;
        }

        clearWarning() {
            this.isWarning = false;
            this.warningMessage = '';
            this.element?.classList.remove('warning');
            this.updateSeq(this.seq); // voltar ao normal title
        }

    destroy() {
      this.element?.remove();
    }
    
    toJSON() {
      const data = {
        seq: this.seq,
        type: this.type.toLowerCase(),
        delay_ms: this.config.delay_ms
      };
      
      if (this.type === 'CLICK' || this.type === 'COORD_CLICK') {
        data.x = Math.round(this.x + BALL_RADIUS);
        data.y = Math.round(this.y + BALL_RADIUS);
        data.random_radius = this.config.random_radius;
      } else if (this.type === 'INPUT') {
        data.x = Math.round(this.x + BALL_RADIUS);
        data.y = Math.round(this.y + BALL_RADIUS);
        data.text = this.config.text;
      } else if (this.type === 'READ') {
        data.selector = this.config.selector;
      }
      
      return data;
    }
  }
  
  // ========== arrasto global ==========
  document.addEventListener('mousemove', (e) => {
    const ball = state.steps.find(b => b.isDragging);
    if (ball) ball.move(e.clientX - ball.offset.x, e.clientY - ball.offset.y);
  }, true);
  
  document.addEventListener('mouseup', () => {
    state.steps.forEach(b => {
      if (b.isDragging) {
        b.isDragging = false;
        b.element.classList.remove('dragging');
      }
    });
  }, true);
  
  // ========== menu do botão direito ==========
  let currentMenu = null;
  
  function showMenu(ball, x, y) {
    hideMenu();
    
    const tc = TYPES[ball.type];
    const menu = el('div', { className: 'wfe-menu' });
    
    menu.appendChild(el('div', { className: 'wfe-menu-header' }, [
      el('div', { className: 'wfe-menu-title' }, [`etapa #${ball.seq}：${tc.name}`]),
      el('div', { className: 'wfe-menu-subtitle' }, [
        ball.type === 'CLICK' ? 'Simule o clique do mouse nesta coordenada' :
        ball.type === 'INPUT' ? 'Digite o texto neste local' :
        'Extraia o texto de um elemento específico'
      ])
    ]));
    
    const body = el('div', { className: 'wfe-menu-body' });
    
    // Atraso     if (ball.seq === 1) {
      body.appendChild(el('div', { className: 'wfe-menu-item disabled' }, [
        el('span', { className: 'wfe-menu-label' }, ['⚡ Etapas iniciais (Sem atraso)'])
      ]));
    } else {
      const delayInput = el('input', {
        type: 'number',
        className: 'wfe-menu-input',
        value: ball.config.delay_ms,
        min: 0,
        step: 100
      });
      delayInput.addEventListener('change', () => ball.config.delay_ms = parseInt(delayInput.value) || 0);
      delayInput.addEventListener('click', e => e.stopPropagation());
      
      body.appendChild(el('div', { className: 'wfe-menu-item' }, [
        el('span', { className: 'wfe-menu-label' }, ['⏱️ distância da etapa anterior (ms)']),
        delayInput
      ]));
    }
    
    body.appendChild(el('div', { className: 'wfe-divider' }));
    
    // tipo específico     if (ball.type !== 'COORD_CLICK') {
      const keyInput = el('input', {
        type: 'text',
        className: 'wfe-menu-input wide',
        value: ball.config.targetKey || '',
        placeholder: 'selector_key'
      });
      keyInput.addEventListener('input', () => {
        const normalized = normalizeKey(keyInput.value);
        ball.config.targetKey = normalized;
        keyInput.value = normalized;
      });
      keyInput.addEventListener('click', e => e.stopPropagation());
      body.appendChild(el('div', { className: 'wfe-menu-item' }, [
        el('span', { className: 'wfe-menu-label' }, ['Key']),
        keyInput
      ]));
    }

    const optionalInput = el('input', {
      type: 'checkbox',
      checked: !ball.config.optional,
      title: 'Se marcada, um erro será relatado se o elemento não puder ser encontrado; se desmarcado, esta etapa será ignorada.'
    });
    optionalInput.addEventListener('change', () => ball.config.optional = !optionalInput.checked);
    optionalInput.addEventListener('click', e => e.stopPropagation());
    body.appendChild(el('div', { className: 'wfe-menu-item' }, [
      el('span', { className: 'wfe-menu-label' }, ['Etapas necessárias']),
      optionalInput
    ]));

    body.appendChild(el('div', { className: 'wfe-divider' }));

    if (ball.type === 'CLICK' || ball.type === 'COORD_CLICK') {
      const radiusInput = el('input', {
        type: 'number',
        className: 'wfe-menu-input',
        value: ball.config.random_radius,
        min: 0,
        max: 50
      });
      radiusInput.addEventListener('change', () => ball.config.random_radius = parseInt(radiusInput.value) || 0);
      radiusInput.addEventListener('click', e => e.stopPropagation());
      
      body.appendChild(el('div', { className: 'wfe-menu-item' }, [
        el('span', { className: 'wfe-menu-label' }, ['🎯 intervalo aleatório (px)']),
        radiusInput
      ]));
      body.appendChild(el('div', { className: 'wfe-menu-item disabled' }, [
        el('span', { className: 'wfe-menu-label' }, [`📍 coordenada: (${Math.round(ball.x + BALL_RADIUS)}, ${Math.round(ball.y + BALL_RADIUS)})`])
      ]));
      if (ball.type === 'CLICK') {
        body.appendChild(el('div', { className: 'wfe-menu-item disabled' }, [
          el('span', { className: 'wfe-menu-label' }, [`Selector: ${ball.config.selector || '(unset)'}`])
        ]));
        const clickPickBtn = el('div', { className: 'wfe-menu-item clickable' }, [
          el('span', { className: 'wfe-menu-label', style: { color: '#8b5cf6' } }, ['Pick element'])
        ]);
        clickPickBtn.addEventListener('click', () => {
          hideMenu();
          startPicker(ball);
        });
        body.appendChild(clickPickBtn);
      }
    } else if (ball.type === 'INPUT') {
      const textInput = el('input', {
        type: 'text',
        className: 'wfe-menu-input wide',
        value: ball.config.text,
        placeholder: 'Insira o conteúdo...'
      });
      textInput.addEventListener('input', () => ball.config.text = textInput.value);
      textInput.addEventListener('click', e => e.stopPropagation());
      
      body.appendChild(el('div', { className: 'wfe-menu-item' }, [
        el('span', { className: 'wfe-menu-label' }, ['✏️ Insira o texto']),
        textInput
      ]));
      body.appendChild(el('div', { className: 'wfe-menu-item disabled' }, [
        el('span', { className: 'wfe-menu-label' }, [`📍 coordenada: (${Math.round(ball.x + BALL_RADIUS)}, ${Math.round(ball.y + BALL_RADIUS)})`])
      ]));
      body.appendChild(el('div', { className: 'wfe-menu-item disabled' }, [
        el('span', { className: 'wfe-menu-label' }, [`Selector: ${ball.config.selector || '(unset)'}`])
      ]));
      const inputPickBtn = el('div', { className: 'wfe-menu-item clickable' }, [
        el('span', { className: 'wfe-menu-label', style: { color: '#8b5cf6' } }, ['Pick element'])
      ]);
      inputPickBtn.addEventListener('click', () => {
        hideMenu();
        startPicker(ball);
      });
      body.appendChild(inputPickBtn);
    } else if (ball.type === 'READ') {
      body.appendChild(el('div', { className: 'wfe-menu-item disabled' }, [
        el('span', { className: 'wfe-menu-label' }, [`🔍 ${ball.config.selector || '(não definido)'}`])
      ]));
      
      const pickBtn = el('div', { className: 'wfe-menu-item clickable' }, [
        el('span', { className: 'wfe-menu-label', style: { color: '#8b5cf6' } }, ['🖱️ Elemento de seleção'])
      ]);
      pickBtn.addEventListener('click', () => {
        hideMenu();
        startPicker(ball);
      });
      body.appendChild(pickBtn);
    }
    
    body.appendChild(el('div', { className: 'wfe-divider' }));
    
    const delBtn = el('div', { className: 'wfe-menu-item clickable danger' }, [
      el('span', { className: 'wfe-menu-label' }, ['❌ Excluir esta etapa'])
    ]);
    delBtn.addEventListener('click', () => {
      removeBall(ball);
      hideMenu();
    });
    body.appendChild(delBtn);
    
    menu.appendChild(body);
    document.body.appendChild(menu);
    
    const rect = menu.getBoundingClientRect();
    menu.style.left = Math.min(x, window.innerWidth - rect.width - 10) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - rect.height - 10) + 'px';
    
    currentMenu = menu;
  }
  
  function hideMenu() {
    currentMenu?.remove();
    currentMenu = null;
  }
  
  document.addEventListener('click', (e) => {
    if (currentMenu && !currentMenu.contains(e.target) && !e.target.closest('.wfe-ball')) {
      hideMenu();
    }
  }, true);
  
  // ========== Seleção de elementos ==========
  let pickOverlay, pickTip, highlighted;
  
  function startPicker(ball) {
    state.isPickingElement = true;
    state.pickingCallback = (selector) => {
      ball.config.selector = selector;
      ball.clearWarning();
      const selectors = state.siteConfig?.selectors || {};
      if (!ball.config.targetKey) {
        ball.config.targetKey = findSelectorKeyByValue(selectors, selector) || generateTargetKey(ball.type, selectors);
      }
      ball.locateToElement();
    };
    
    pickOverlay = el('div', { className: 'wfe-pick-overlay' });
    pickTip = el('div', { className: 'wfe-pick-tip' }, ['🎯 Clique na seleção do elemento | ESC Cancelar']);
    
    document.body.append(pickOverlay, pickTip);
    
    pickOverlay.addEventListener('mousemove', onPickMove);
    pickOverlay.addEventListener('click', onPickClick);
    document.addEventListener('keydown', onPickKey);
  }
  
  function onPickMove(e) {
    pickOverlay.style.pointerEvents = 'none';
    const target = document.elementFromPoint(e.clientX, e.clientY);
    pickOverlay.style.pointerEvents = 'auto';
    
    highlighted?.classList.remove('wfe-highlight');
    
    if (target && target !== document.body && !target.className?.includes?.('wfe-')) {
      target.classList.add('wfe-highlight');
      highlighted = target;
    }
  }
  
  function onPickClick(e) {
    pickOverlay.style.pointerEvents = 'none';
    const target = document.elementFromPoint(e.clientX, e.clientY);
    pickOverlay.style.pointerEvents = 'auto';
    
    if (target && highlighted && state.pickingCallback) {
      state.pickingCallback(generateSelector(target));
    }
    endPicker();
  }
  
  function onPickKey(e) {
    if (e.key === 'Escape') endPicker();
  }
  
  function endPicker() {
    state.isPickingElement = false;
    state.pickingCallback = null;
    highlighted?.classList.remove('wfe-highlight');
    highlighted = null;
    pickOverlay?.remove();
    pickTip?.remove();
    document.removeEventListener('keydown', onPickKey);
  }
  
    // ========== gerenciamento de bola pequena ==========
    function addBall(type, config = {}) {
        const seq = state.steps.length + 1;

        // Posição padrão: escalonado         let x = Number.isFinite(config.x) ? config.x - BALL_RADIUS : 100 + (seq - 1) * 40;
        let y = Number.isFinite(config.y) ? config.y - BALL_RADIUS : window.innerHeight / 2;
        let elementNotFound = false;

        if (config.selector) {
            const target = findElement(config.selector);
            if (target) {
                const pos = getElementCenter(target);
                if (pos) {
                    x = pos.x - BALL_RADIUS;
                    y = pos.y - BALL_RADIUS;
                }
            } else {
                // Elemento não encontrado, marca com status de aviso                 elementNotFound = true;
                console.warn(`[WorkflowEditor] ⚠️ elemento não encontrado: ${config.selector}`);
            }
        }

        const ball = new Ball({
            type,
            seq,
            x,
            y,
            config
        });

        state.steps.push(ball);

        // Defina o status de aviso se o elemento não for encontrado         if (elementNotFound) {
            ball.setWarning(`elemento não existe: ${config.selector}`);
        }

        // Selecionado automaticamente apenas ao criar uma nova etapa; clique nas coordenadas para usar diretamente as coordenadas salvas         if (!config.selector && !Number.isFinite(config.x) && ['CLICK', 'INPUT', 'READ'].includes(type)) {
            setTimeout(() => startPicker(ball), 100);
        }

        return ball;
    }
  function removeBall(ball) {
    const idx = state.steps.indexOf(ball);
    if (idx > -1) {
      ball.destroy();
      state.steps.splice(idx, 1);
      state.steps.forEach((b, i) => b.updateSeq(i + 1));
    }
  }
  
  function clearAll() {
    state.steps.forEach(b => b.destroy());
    state.steps = [];
  }
  
  function exportConfig() {
    return state.steps.map(b => b.toJSON());
  }
  
    // ========== 🔧 Carregar a configuração existente (ler a latência real)==========
    function loadFromConfig(config) {
        clearAll();
        state.siteConfig = {
            ...(config || {}),
            selectors: { ...((config && config.selectors) || {}) },
            workflow: Array.isArray(config?.workflow) ? config.workflow : []
        };

        const workflow = state.siteConfig.workflow;
        let pendingDelay = 0; // Acumular frente WAIT atraso de passo          workflow.forEach((step, idx) => {
            const action = step.action;

            // tratar WAIT Etapa: acumular atraso para a próxima ação             if (action === 'WAIT') {
                const waitValue = parseFloat(step.value) || 0;
                pendingDelay += waitValue * 1000; // Converter para milissegundos                 return;
            }

            // pular sobre KEY_PRESS Aguarde outras etapas             if (!['CLICK', 'COORD_CLICK', 'FILL_INPUT', 'STREAM_WAIT'].includes(action)) {
                console.log(`[WorkflowEditor] pular tipo de etapa: ${action}`);
                return;
            }

            const targetKey = step.target;
            const selector = state.siteConfig.selectors[targetKey];

            let type, stepConfig = {};

            if (action === 'CLICK') {
                type = 'CLICK';
                stepConfig = {
                    delay_ms: pendingDelay,
                    random_radius: 10,
                    selector: selector,
                    targetKey: targetKey,
                    optional: !!step.optional
                };
            } else if (action === 'COORD_CLICK') {
                type = 'COORD_CLICK';
                stepConfig = {
                    delay_ms: pendingDelay,
                    x: Number(step.value?.x ?? 100),
                    y: Number(step.value?.y ?? (window.innerHeight / 2)),
                    random_radius: Number(step.value?.random_radius ?? 10),
                    targetKey: targetKey || '',
                    optional: !!step.optional
                };
            } else if (action === 'FILL_INPUT') {
                type = 'INPUT';
                stepConfig = {
                    delay_ms: pendingDelay,
                    text: step.value || '',
                    selector: selector,
                    targetKey: targetKey,
                    optional: !!step.optional
                };
            } else if (action === 'STREAM_WAIT') {
                type = 'READ';
                stepConfig = {
                    delay_ms: pendingDelay,
                    selector: selector || '',
                    targetKey: targetKey,
                    optional: !!step.optional
                };
            }

            addBall(type, stepConfig);
            pendingDelay = 0; // atraso de redefinição         });

        console.log(`[WorkflowEditor] ✅ Carregado ${state.steps.length} passos`);

        // Resuma os elementos não encontrados         const warningBalls = state.steps.filter(b => b.isWarning);
        if (warningBalls.length > 0) {
            const missingSelectors = warningBalls
                .map(b => `• ${b.config.targetKey || 'desconhecido'}: ${b.config.selector}`)
                .join('\n');

            setTimeout(() => {
                alert(
                    `⚠️ abaixo ${warningBalls.length} O elemento correspondente ao seletor não existe atualmente:\n\n` +
                    `${missingSelectors}\n\n` +
                    `Possíveis razões:\n` +
                    `1. Os elementos requerem operações específicas antes de aparecerem (como quando a caixa de entrada tem conteúdo)\n` +
                    `2. A página não foi totalmente carregada\n` +
                    `3. O seletor é inválido e precisa ser atualizado\n\n` +
                    `Uma bola marcada em vermelho indica que o elemento não foi encontrado.`
                );
            }, 300);
        }
    }
    
  // ========== Barra de ferramentas ==========
  let toolbar;
  
  function createToolbar() {
    if (toolbar) return;
    
      toolbar = el('div', { className: 'wfe-toolbar', id: 'wfe-toolbar' }, [
          el('button', { className: 'wfe-btn', 'data-action': 'add-coord-click' }, ['+ Coord']),
          el('button', { className: 'wfe-btn', 'data-action': 'add-click' }, ['+ Clique']),
          el('button', { className: 'wfe-btn', 'data-action': 'add-input' }, ['+ digitar']),
          el('button', { className: 'wfe-btn', 'data-action': 'add-read' }, ['+ ler']),
          el('button', { className: 'wfe-btn primary', 'data-action': 'save' }, ['💾 manter']),
          el('button', { className: 'wfe-btn danger', 'data-action': 'clear' }, ['Claro']),
          el('button', { className: 'wfe-btn', 'data-action': 'close' }, ['✖'])
      ]);
    
    document.body.appendChild(toolbar);
    
    toolbar.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      
        switch (btn.dataset.action) {
            case 'add-coord-click': addBall('COORD_CLICK'); break;
            case 'add-click': addBall('CLICK'); break;
            case 'add-input': addBall('INPUT'); break;
            case 'add-read': addBall('READ'); break;
            case 'save': doSave(); break;
            case 'clear': if (confirm('Tem certeza de que deseja limpar todas as etapas?')) clearAll(); break;
            case 'close': hideEditor(); break;
        }
    });
  }
  
    async function doSave() {
        if (!state.siteConfig) {
            state.siteConfig = { selectors: {}, workflow: [] };
        }

        const steps = state.steps;
        const selectors = { ...(state.siteConfig.selectors || {}) };

        // construir novo workflow variedade         const newWorkflow = [];

        steps.forEach((ball, idx) => {
            const delayMs = ball.config.delay_ms || 0;
            const targetKey = ball.type === 'CLICK'
                ? normalizeKey(ball.config.targetKey || '')
                : ['INPUT', 'READ'].includes(ball.type)
                    ? ensureBallTargetKey(ball, selectors)
                    : '';

            // Se houver um atraso, insira WAIT etapa             if (delayMs > 0) {
                newWorkflow.push({
                    action: 'WAIT',
                    target: '',
                    optional: false,
                    value: delayMs / 1000 // Converter para segundos                 });
            }

            // Insira etapas de ação reais             if (ball.type === 'CLICK') {
                if (ball.config.selector && targetKey) {
                    selectors[targetKey] = ball.config.selector;
                }
                newWorkflow.push({
                    action: 'CLICK',
                    target: targetKey || '',
                    optional: !!ball.config.optional,
                    value: null
                });
            } else if (ball.type === 'COORD_CLICK') {
                newWorkflow.push({
                    action: 'COORD_CLICK',
                    target: '',
                    optional: !!ball.config.optional,
                    value: {
                        x: Math.round(ball.x + BALL_RADIUS),
                        y: Math.round(ball.y + BALL_RADIUS),
                        random_radius: Number(ball.config.random_radius || 0)
                    }
                });
            } else if (ball.type === 'INPUT') {
                newWorkflow.push({
                    action: 'FILL_INPUT',
                    target: targetKey || 'input_box',
                    optional: !!ball.config.optional,
                    value: ball.config.text || null
                });
            } else if (ball.type === 'READ') {
                newWorkflow.push({
                    action: 'STREAM_WAIT',
                    target: targetKey || 'result_container',
                    optional: !!ball.config.optional,
                    value: null
                });
            }
        });

        // Obtenha o nome de domínio atual         const domain = window.location.hostname;
        const presetName = window.__WORKFLOW_EDITOR_PRESET_NAME__ || state.presetName || 'predefinição mestre';

        console.log('[WorkflowEditor] Salvar configuração:', { domain, presetName, workflow: newWorkflow, selectors });

        try {
            const response = await fetch(`${API_BASE}/api/sites/${domain}/workflow`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    workflow: newWorkflow,
                    selectors,
                    preset_name: presetName
                })
            });

            if (response.ok) {
                const result = await response.json();
                state.siteConfig = {
                    ...state.siteConfig,
                    selectors,
                    workflow: newWorkflow
                };
                alert(`✅ Salvo com sucesso!\n\natualizado ${steps.length} passos para ${domain} / ${presetName}`);
                console.log('[WorkflowEditor] Salvar resultados:', result);
            } else {
                const error = await response.json();
                alert(`❌ Falha ao salvar: ${error.message || error.detail || 'erro desconhecido'}`);
            }
        } catch (e) {
            console.error('[WorkflowEditor] Salvar exceção:', e);

            // Detecção CSP Ou erro de rede, forneça solução de downgrade             if (e.message?.includes('Failed to fetch') || e.message?.includes('Content Security Policy')) {
                const exportData = {
                    ...(state.siteConfig || {}),
                    selectors,
                    workflow: newWorkflow
                };
                const jsonStr = JSON.stringify(exportData, null, 2);

                // Tente copiar para a área de transferência                 try {
                    await navigator.clipboard.writeText(jsonStr);
                    alert(
                        `⚠️ Devido às restrições da política de segurança deste site, ele não pode ser salvo diretamente.\n\n` +
                        `A configuração predefinida atual foi copiada para a área de transferência.\n\n` +
                        `Por favor, retorne ao painel de controle "Visualizar JSON」，Cole e salve a predefinição atual diretamente.`
                    );
                    console.log('[WorkflowEditor] Configuração copiada para a área de transferência:', exportData);
                } catch (clipboardError) {
                    // A área de transferência também falha, mostrando JSON Permitir que os usuários copiem manualmente                     console.error('[WorkflowEditor] Falha na gravação da área de transferência:', clipboardError);
                    prompt(
                        '⚠️ Não é possível salvar ou copiar automaticamente. Copie a seguinte configuração manualmente:',
                        jsonStr
                    );
                }
            } else {
                alert(`❌ Falha ao salvar: ${e.message}`);
            }
        }
    }
  
  function showEditor() {
    state.isVisible = true;
    toolbar?.classList.remove('wfe-hidden');
    state.steps.forEach(b => b.element?.classList.remove('wfe-hidden'));
  }
  
  function hideEditor() {
    state.isVisible = false;
    toolbar?.classList.add('wfe-hidden');
    state.steps.forEach(b => b.element?.classList.add('wfe-hidden'));
    hideMenu();
    endPicker();
  }
  
  // ========== inicialização ==========
    function init() {
        console.log('[WorkflowEditor] 🚀 Inicializando...');
        injectStyles();
        createToolbar();

        const config = window.__WORKFLOW_EDITOR_CONFIG__;
        const targetDomain = window.__WORKFLOW_EDITOR_TARGET_DOMAIN__;
        state.presetName = window.__WORKFLOW_EDITOR_PRESET_NAME__ || null;
        const currentDomain = window.location.hostname;

        // Verificação de nome de domínio         if (targetDomain && targetDomain !== currentDomain) {
            alert(
                `❌ O nome de domínio não corresponde!\n\n` +
                `Configurar destino: ${targetDomain}\n` +
                `página atual: ${currentDomain}\n\n` +
                `Navegue até o site correto e tente novamente.`
            );
            console.error(`[WorkflowEditor] O nome de domínio não corresponde: esperar ${targetDomain}, real ${currentDomain}`);
            hideEditor();
            return;
        }

        // Carregar configuração automaticamente         if (config) {
            state.siteConfig = config;
            loadFromConfig(state.siteConfig);
        } else {
            console.log('[WorkflowEditor] Nenhuma configuração fornecida, entre no modo de edição em branco');
            alert(
                `⚠️ Site atual não encontrado (${currentDomain}) configuração.\n\n` +
                `Você pode adicionar etapas manualmente, mas o recurso de salvar pode não estar disponível.`
            );
        }

        console.log('[WorkflowEditor] ✅ Editor está pronto');
    }
  
  init();
  
  window.WorkflowEditor = {
    addClick: () => addBall('CLICK'),
    addCoordClick: () => addBall('COORD_CLICK'),
    addInput: () => addBall('INPUT'),
    addRead: () => addBall('READ'),
    clear: clearAll,
    export: exportConfig,
    show: showEditor,
    hide: hideEditor,
    getSteps: () => state.steps.map(b => b.toJSON()),
    reload: () => {
      state.presetName = window.__WORKFLOW_EDITOR_PRESET_NAME__ || state.presetName || null;
      loadFromConfig(window.__WORKFLOW_EDITOR_CONFIG__ || state.siteConfig);
    }
  };
  
})();
