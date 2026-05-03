// Pollytics Chatbot — Polly
// Include this file on any page: <script src="/chatbot.js"></script>
// Optionally set window.POLLY_CONTEXT before loading:
//   window.POLLY_CONTEXT = { type: 'poll'|'survey'|'dashboard', id: 'uuid' }

(function() {
  const ACCENT  = '#d4af37';
  const BG      = '#0a0a0a';
  const SURFACE = '#181818';
  const SURFACE2= '#222222';
  const BORDER  = 'rgba(212,175,55,0.2)';
  const TEXT     = '#f5f0e8';
  const MUTED    = '#8a8070';

  // ── Inject styles ──────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    #polly-fab {
      position:fixed;bottom:24px;right:24px;z-index:9999;
      width:56px;height:56px;border-radius:50%;
      background:${ACCENT};border:none;cursor:pointer;
      display:flex;align-items:center;justify-content:center;
      box-shadow:0 4px 24px rgba(212,175,55,0.4);
      transition:transform .2s,box-shadow .2s;
    }
    #polly-fab:hover{transform:scale(1.08);box-shadow:0 6px 32px rgba(212,175,55,0.55)}
    #polly-fab:active{transform:scale(.96)}
    #polly-fab svg{transition:transform .25s}
    #polly-fab.open svg.icon-chat{display:none}
    #polly-fab.open svg.icon-close{display:block!important}

    #polly-window {
      position:fixed;bottom:92px;right:24px;z-index:9999;
      width:360px;max-width:calc(100vw - 32px);
      height:520px;max-height:calc(100vh - 120px);
      background:${SURFACE};
      border:1px solid ${BORDER};
      border-radius:16px;
      display:flex;flex-direction:column;
      box-shadow:0 8px 48px rgba(0,0,0,.6);
      transform:scale(.95) translateY(12px);
      opacity:0;pointer-events:none;
      transition:transform .22s cubic-bezier(.4,0,.2,1),opacity .22s;
    }
    #polly-window.open{transform:scale(1) translateY(0);opacity:1;pointer-events:all}

    #polly-header {
      padding:.85rem 1rem;
      border-bottom:1px solid ${BORDER};
      display:flex;align-items:center;gap:10px;
      border-radius:16px 16px 0 0;
      background:${SURFACE};
      flex-shrink:0;
    }
    #polly-avatar {
      width:32px;height:32px;border-radius:50%;
      background:${ACCENT};display:flex;align-items:center;justify-content:center;
      font-size:16px;flex-shrink:0;
    }
    #polly-header-text{}
    #polly-header-name{font-family:'Syne',sans-serif;font-size:.9rem;font-weight:700;color:${TEXT}}
    #polly-header-status{font-size:11px;color:${MUTED};display:flex;align-items:center;gap:5px}
    #polly-status-dot{width:6px;height:6px;border-radius:50%;background:#4ecf80;display:inline-block}
    #polly-close{margin-left:auto;background:none;border:none;cursor:pointer;color:${MUTED};font-size:18px;padding:4px;line-height:1;transition:color .15s}
    #polly-close:hover{color:${TEXT}}

    #polly-messages {
      flex:1;overflow-y:auto;padding:.85rem 1rem;
      display:flex;flex-direction:column;gap:.6rem;
      scroll-behavior:smooth;
    }
    #polly-messages::-webkit-scrollbar{width:4px}
    #polly-messages::-webkit-scrollbar-track{background:transparent}
    #polly-messages::-webkit-scrollbar-thumb{background:rgba(212,175,55,.2);border-radius:999px}

    .polly-msg {
      max-width:85%;display:flex;flex-direction:column;gap:3px;
      animation:pollyFadeIn .18s ease;
    }
    @keyframes pollyFadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
    .polly-msg.user{align-self:flex-end}
    .polly-msg.assistant{align-self:flex-start}
    .polly-bubble {
      padding:.55rem .85rem;border-radius:12px;
      font-size:13px;line-height:1.55;
      font-family:'DM Sans',sans-serif;
    }
    .polly-msg.user .polly-bubble{background:${ACCENT};color:#0a0a0a;font-weight:500;border-radius:12px 12px 2px 12px}
    .polly-msg.assistant .polly-bubble{background:${SURFACE2};color:${TEXT};border:1px solid rgba(212,175,55,.1);border-radius:12px 12px 12px 2px}
    .polly-bubble strong{font-weight:700}
    .polly-bubble ul,.polly-bubble ol{padding-left:1.1rem;margin:.3rem 0}
    .polly-bubble li{margin-bottom:.2rem}
    .polly-bubble p{margin-bottom:.35rem}
    .polly-bubble p:last-child{margin-bottom:0}
    .polly-time{font-size:10px;color:${MUTED};padding:0 .2rem}
    .polly-msg.user .polly-time{text-align:right}

    .polly-typing{display:flex;align-items:center;gap:4px;padding:.55rem .85rem}
    .polly-typing span{width:6px;height:6px;border-radius:50%;background:${ACCENT};display:inline-block;animation:pollyDot 1.2s ease-in-out infinite}
    .polly-typing span:nth-child(2){animation-delay:.2s}
    .polly-typing span:nth-child(3){animation-delay:.4s}
    @keyframes pollyDot{0%,80%,100%{transform:scale(.7);opacity:.5}40%{transform:scale(1);opacity:1}}

    #polly-suggestions {
      padding:.5rem 1rem .25rem;
      display:flex;flex-wrap:wrap;gap:5px;
      flex-shrink:0;
    }
    .polly-suggestion {
      font-size:11px;padding:4px 10px;border-radius:999px;
      background:${SURFACE2};border:1px solid rgba(212,175,55,.2);
      color:${MUTED};cursor:pointer;
      font-family:'DM Sans',sans-serif;
      transition:all .15s;white-space:nowrap;
    }
    .polly-suggestion:hover{border-color:${ACCENT};color:${ACCENT};background:rgba(212,175,55,.06)}

    #polly-input-area {
      padding:.75rem 1rem;
      border-top:1px solid ${BORDER};
      display:flex;gap:8px;align-items:flex-end;
      flex-shrink:0;
      border-radius:0 0 16px 16px;
      background:${SURFACE};
    }
    #polly-input {
      flex:1;background:${SURFACE2};border:1px solid rgba(212,175,55,.15);
      border-radius:10px;padding:.55rem .85rem;
      color:${TEXT};font-family:'DM Sans',sans-serif;font-size:13px;
      outline:none;resize:none;line-height:1.4;max-height:100px;
      transition:border-color .15s;
    }
    #polly-input:focus{border-color:${ACCENT}}
    #polly-input::placeholder{color:${MUTED}}
    #polly-send {
      width:34px;height:34px;border-radius:10px;
      background:${ACCENT};border:none;cursor:pointer;
      display:flex;align-items:center;justify-content:center;
      flex-shrink:0;transition:all .15s;
    }
    #polly-send:hover{background:#f0cd60;transform:scale(1.05)}
    #polly-send:disabled{opacity:.4;cursor:default;transform:none}

    @media(max-width:480px){
      #polly-window{width:calc(100vw - 16px);right:8px;bottom:80px;height:calc(100vh - 100px)}
      #polly-fab{bottom:16px;right:16px}
    }
  `;
  document.head.appendChild(style);

  // ── Build DOM ──────────────────────────────────────────────
  const fab = document.createElement('button');
  fab.id = 'polly-fab';
  fab.setAttribute('aria-label', 'Chat with Polly');
  fab.innerHTML = `
    <svg class="icon-chat" width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="#0a0a0a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <svg class="icon-close" width="18" height="18" viewBox="0 0 24 24" fill="none" style="display:none">
      <path d="M18 6L6 18M6 6l12 12" stroke="#0a0a0a" stroke-width="2.5" stroke-linecap="round"/>
    </svg>`;

  const win = document.createElement('div');
  win.id = 'polly-window';
  win.setAttribute('role','dialog');
  win.setAttribute('aria-label','Polly AI Assistant');
  win.innerHTML = `
    <div id="polly-header">
      <div id="polly-avatar">🦜</div>
      <div id="polly-header-text">
        <div id="polly-header-name">Polly</div>
        <div id="polly-header-status"><span id="polly-status-dot"></span> AI Analysis Assistant</div>
      </div>
      <button id="polly-close" aria-label="Close chat">✕</button>
    </div>
    <div id="polly-messages"></div>
    <div id="polly-suggestions"></div>
    <div id="polly-input-area">
      <textarea id="polly-input" rows="1" placeholder="Ask Polly anything about your data…"></textarea>
      <button id="polly-send" aria-label="Send">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z" stroke="#0a0a0a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>`;

  document.body.appendChild(fab);
  document.body.appendChild(win);

  // ── State ──────────────────────────────────────────────────
  const messages = [];
  let isOpen    = false;
  let isLoading = false;
  const ctx     = window.POLLY_CONTEXT || null;

  // Suggestions based on context
  const suggestions = ctx
    ? ctx.type === 'dashboard'
      ? ['Compare my polls', 'What trends do you see?', 'Which poll got most votes?', 'Recommend next steps']
      : ['Analyze this data', 'Who is the winner?', 'Key takeaways?', 'Stakeholder recommendations']
    : ['What is Pollytics?', 'How do I create a poll?', 'What is a survey?', 'How does AI analysis work?'];

  // ── Init ───────────────────────────────────────────────────
  function init() {
    // Welcome message
    addMessage('assistant', `Hi! I'm **Polly**, your AI analysis assistant. 🦜\n\n${ctx ? 'I can see your poll/survey data. Ask me anything about it — analysis, trends, recommendations for stakeholders, or anything else!' : 'I\'m here to help you understand your poll data and make the most of Pollytics. What would you like to know?'}`);
    renderSuggestions();
  }

  // ── Toggle ─────────────────────────────────────────────────
  function toggle() {
    isOpen = !isOpen;
    fab.classList.toggle('open', isOpen);
    win.classList.toggle('open', isOpen);
    if (isOpen) {
      setTimeout(() => document.getElementById('polly-input')?.focus(), 250);
      scrollToBottom();
    }
  }

  fab.addEventListener('click', toggle);
  document.getElementById('polly-close').addEventListener('click', toggle);

  // ── Render suggestions ─────────────────────────────────────
  function renderSuggestions() {
    const el = document.getElementById('polly-suggestions');
    el.innerHTML = suggestions.map(s =>
      `<button class="polly-suggestion" onclick="pollySend(${JSON.stringify(s)})">${s}</button>`
    ).join('');
  }

  // ── Add message ────────────────────────────────────────────
  function addMessage(role, text) {
    messages.push({ role, content: text });
    const container = document.getElementById('polly-messages');
    const div = document.createElement('div');
    div.className = `polly-msg ${role}`;
    const time = new Date().toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit' });
    div.innerHTML = `
      <div class="polly-bubble">${formatMarkdown(text)}</div>
      <div class="polly-time">${time}</div>`;
    container.appendChild(div);
    scrollToBottom();
  }

  // ── Typing indicator ───────────────────────────────────────
  function showTyping() {
    const container = document.getElementById('polly-messages');
    const div = document.createElement('div');
    div.className = 'polly-msg assistant';
    div.id = 'polly-typing-indicator';
    div.innerHTML = `<div class="polly-bubble polly-typing"><span></span><span></span><span></span></div>`;
    container.appendChild(div);
    scrollToBottom();
  }
  function hideTyping() {
    document.getElementById('polly-typing-indicator')?.remove();
  }

  // ── Send message ───────────────────────────────────────────
  window.pollySend = async function(text) {
    text = (text || document.getElementById('polly-input').value).trim();
    if (!text || isLoading) return;

    // Clear suggestions after first user message
    document.getElementById('polly-suggestions').innerHTML = '';

    addMessage('user', text);
    document.getElementById('polly-input').value = '';
    autoResize();

    isLoading = true;
    document.getElementById('polly-send').disabled = true;
    showTyping();

    try {
      const token = localStorage.getItem('ps_token');
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = 'Bearer ' + token;

      const body = {
        messages: messages.slice(-12), // last 12 messages for context window
        context_type: ctx?.type || null,
        context_id:   ctx?.id   || null,
      };

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      hideTyping();

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Request failed');
      }

      const data = await res.json();
      addMessage('assistant', data.reply);
    } catch (e) {
      hideTyping();
      addMessage('assistant', `Sorry, I ran into an error: ${e.message}. Please try again.`);
    } finally {
      isLoading = false;
      document.getElementById('polly-send').disabled = false;
    }
  };

  // ── Input handlers ─────────────────────────────────────────
  function autoResize() {
    const ta = document.getElementById('polly-input');
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 100) + 'px';
  }

  document.getElementById('polly-input').addEventListener('input', autoResize);
  document.getElementById('polly-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      window.pollySend();
    }
  });
  document.getElementById('polly-send').addEventListener('click', () => window.pollySend());

  // ── Scroll ─────────────────────────────────────────────────
  function scrollToBottom() {
    const el = document.getElementById('polly-messages');
    if (el) el.scrollTop = el.scrollHeight;
  }

  // ── Markdown formatter ─────────────────────────────────────
  function formatMarkdown(text) {
    return text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/^#{1,3}\s+(.+)$/gm, '<strong>$1</strong>')
      .replace(/^[-•]\s+(.+)$/gm, '<li>$1</li>')
      .replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>')
      .replace(/^(.+)$/, '<p>$1</p>')
      .replace(/<p><\/p>/g, '');
  }

  init();
})();
