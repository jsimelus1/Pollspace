/* Pollytics — Polly Chatbot Widget
   Drop <script src="/chatbot.js"></script> on any page.
   Optionally set window.POLLY_CONTEXT = { type, id } before the tag.
*/
(function () {
  'use strict';

  /* ── run after DOM is ready ── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

  function mount() {

    /* ── CSS ── */
    var s = document.createElement('style');
    s.textContent = [
      '#polly-fab{position:fixed;bottom:24px;right:24px;z-index:9999;width:56px;height:56px;border-radius:50%;background:#d4af37;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 24px rgba(212,175,55,.45);transition:transform .2s,box-shadow .2s}',
      '#polly-fab:hover{transform:scale(1.08);box-shadow:0 6px 32px rgba(212,175,55,.6)}',
      '#polly-fab:active{transform:scale(.95)}',
      '#polly-win{position:fixed;bottom:92px;right:24px;z-index:9999;width:360px;max-width:calc(100vw - 32px);height:520px;max-height:calc(100vh - 120px);background:#181818;border:1px solid rgba(212,175,55,.25);border-radius:16px;display:flex;flex-direction:column;box-shadow:0 8px 48px rgba(0,0,0,.7);opacity:0;pointer-events:none;transform:scale(.95) translateY(12px);transition:opacity .22s,transform .22s cubic-bezier(.4,0,.2,1)}',
      '#polly-win.open{opacity:1;pointer-events:all;transform:scale(1) translateY(0)}',
      '#polly-head{padding:.85rem 1rem;border-bottom:1px solid rgba(212,175,55,.18);display:flex;align-items:center;gap:10px;flex-shrink:0;border-radius:16px 16px 0 0}',
      '#polly-av{width:34px;height:34px;border-radius:50%;background:#d4af37;display:flex;align-items:center;justify-content:center;font-size:17px;flex-shrink:0}',
      '#polly-hname{font-weight:700;color:#f5f0e8;font-size:.9rem}',
      '#polly-hsub{font-size:11px;color:#8a8070;display:flex;align-items:center;gap:4px}',
      '.polly-dot{width:6px;height:6px;border-radius:50%;background:#4ecf80;display:inline-block}',
      '#polly-x{margin-left:auto;background:none;border:none;color:#8a8070;font-size:20px;cursor:pointer;line-height:1;padding:4px;transition:color .15s}',
      '#polly-x:hover{color:#f5f0e8}',
      '#polly-msgs{flex:1;overflow-y:auto;padding:.85rem 1rem;display:flex;flex-direction:column;gap:.6rem;scroll-behavior:smooth}',
      '#polly-msgs::-webkit-scrollbar{width:3px}',
      '#polly-msgs::-webkit-scrollbar-thumb{background:rgba(212,175,55,.2);border-radius:999px}',
      '.pm{max-width:86%;display:flex;flex-direction:column;gap:2px;animation:pfade .18s ease}',
      '@keyframes pfade{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}',
      '.pm.u{align-self:flex-end}.pm.a{align-self:flex-start}',
      '.pb{padding:.55rem .85rem;border-radius:12px;font-size:13px;line-height:1.6;font-family:"DM Sans",sans-serif}',
      '.pm.u .pb{background:#d4af37;color:#0a0a0a;font-weight:500;border-radius:12px 12px 2px 12px}',
      '.pm.a .pb{background:#222;color:#f5f0e8;border:1px solid rgba(212,175,55,.1);border-radius:12px 12px 12px 2px}',
      '.pb ul{padding-left:1.1rem;margin:.25rem 0}.pb li{margin-bottom:.2rem}',
      '.pb strong{font-weight:700}.pb p{margin-bottom:.3rem}.pb p:last-child{margin-bottom:0}',
      '.pt{font-size:10px;color:#8a8070;padding:0 .2rem}.pm.u .pt{text-align:right}',
      '#polly-typing{align-self:flex-start;padding:.55rem .85rem;background:#222;border-radius:12px 12px 12px 2px;border:1px solid rgba(212,175,55,.1);display:flex;gap:4px;align-items:center}',
      '.pd{width:6px;height:6px;border-radius:50%;background:#d4af37;animation:pdot 1.2s ease-in-out infinite}',
      '.pd:nth-child(2){animation-delay:.2s}.pd:nth-child(3){animation-delay:.4s}',
      '@keyframes pdot{0%,80%,100%{transform:scale(.65);opacity:.4}40%{transform:scale(1);opacity:1}}',
      '#polly-chips{padding:.5rem 1rem .25rem;display:flex;flex-wrap:wrap;gap:5px;flex-shrink:0}',
      '.pc{font-size:11px;padding:4px 10px;border-radius:999px;background:#222;border:1px solid rgba(212,175,55,.2);color:#8a8070;cursor:pointer;font-family:"DM Sans",sans-serif;transition:all .15s;white-space:nowrap}',
      '.pc:hover{border-color:#d4af37;color:#d4af37}',
      '#polly-bar{padding:.7rem 1rem;border-top:1px solid rgba(212,175,55,.15);display:flex;gap:8px;align-items:flex-end;flex-shrink:0;border-radius:0 0 16px 16px;background:#181818}',
      '#polly-inp{flex:1;background:#222;border:1px solid rgba(212,175,55,.15);border-radius:10px;padding:.55rem .85rem;color:#f5f0e8;font-family:"DM Sans",sans-serif;font-size:13px;outline:none;resize:none;line-height:1.4;max-height:100px;transition:border-color .15s}',
      '#polly-inp:focus{border-color:#d4af37}',
      '#polly-inp::placeholder{color:#6a6055}',
      '#polly-btn{width:34px;height:34px;border-radius:10px;background:#d4af37;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .15s}',
      '#polly-btn:hover{background:#f0cd60}',
      '#polly-btn:disabled{opacity:.35;cursor:default}',
      '@media(max-width:480px){#polly-win{width:calc(100vw - 16px);right:8px;bottom:80px;height:calc(100vh - 100px)}#polly-fab{bottom:16px;right:16px}}'
    ].join('');
    document.head.appendChild(s);

    /* ── FAB ── */
    var fab = document.createElement('button');
    fab.id = 'polly-fab';
    fab.title = 'Chat with Polly';
    fab.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="#0a0a0a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    document.body.appendChild(fab);

    /* ── Window ── */
    var win = document.createElement('div');
    win.id = 'polly-win';
    win.innerHTML = [
      '<div id="polly-head">',
        '<div id="polly-av">🦜</div>',
        '<div>',
          '<div id="polly-hname">Polly</div>',
          '<div id="polly-hsub"><span class="polly-dot"></span>&nbsp;AI Analysis Assistant</div>',
        '</div>',
        '<button id="polly-x" title="Close">&#10005;</button>',
      '</div>',
      '<div id="polly-msgs"></div>',
      '<div id="polly-chips"></div>',
      '<div id="polly-bar">',
        '<textarea id="polly-inp" rows="1" placeholder="Ask Polly about your data\u2026"></textarea>',
        '<button id="polly-btn" title="Send">',
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none">',
            '<path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z" stroke="#0a0a0a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>',
          '</svg>',
        '</button>',
      '</div>'
    ].join('');
    document.body.appendChild(win);

    /* ── State ── */
    var history  = [];   // {role, content}
    var busy     = false;
    var opened   = false;

    /* ── Suggestions ── */
    var ctx   = window.POLLY_CONTEXT || null;
    var chips = ctx
      ? (ctx.type === 'dashboard'
          ? ['Compare my polls','Trends?','Most votes?','Next steps']
          : ['Analyze this','Who won?','Key takeaways','Recommendations'])
      : ['How do I create a poll?','What is a survey?','How does AI work here?','What is Pollytics?'];

    renderChips();

    /* ── Welcome message ── */
    addMsg('a', ctx
      ? 'Hi! I\'m **Polly** 🦜 — I can see your data. Ask me anything about it!'
      : 'Hi! I\'m **Polly** 🦜 — your AI assistant. Ask me anything about Pollytics or your polls!');

    /* ── Open / Close ── */
    function toggle() {
      opened = !opened;
      win.classList.toggle('open', opened);
      fab.innerHTML = opened
        ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="#0a0a0a" stroke-width="2.5" stroke-linecap="round"/></svg>'
        : '<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="#0a0a0a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      if (opened) { setTimeout(function(){ document.getElementById('polly-inp').focus(); }, 200); scroll(); }
    }

    fab.addEventListener('click', toggle);
    document.getElementById('polly-x').addEventListener('click', toggle);

    /* ── Chips ── */
    function renderChips() {
      var el = document.getElementById('polly-chips');
      el.innerHTML = chips.map(function(c) {
        return '<button class="pc" onclick="(function(){document.getElementById(\'polly-inp\').value='+JSON.stringify(c)+';document.getElementById(\'polly-btn\').click()})()">' + c + '</button>';
      }).join('');
    }

    /* ── Add message ── */
    function addMsg(role, text) {
      history.push({ role: role === 'u' ? 'user' : 'assistant', content: text });
      var msgs = document.getElementById('polly-msgs');
      var now  = new Date().toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit' });
      var d    = document.createElement('div');
      d.className = 'pm ' + role;
      d.innerHTML = '<div class="pb">' + md(text) + '</div><div class="pt">' + now + '</div>';
      msgs.appendChild(d);
      scroll();
    }

    function showTyping() {
      var msgs = document.getElementById('polly-msgs');
      var d = document.createElement('div');
      d.id = 'polly-typing';
      d.innerHTML = '<div class="pd"></div><div class="pd"></div><div class="pd"></div>';
      msgs.appendChild(d);
      scroll();
    }
    function hideTyping() { var t = document.getElementById('polly-typing'); if (t) t.remove(); }

    /* ── Send ── */
    function send() {
      var inp  = document.getElementById('polly-inp');
      var text = inp.value.trim();
      if (!text || busy) return;

      // Clear chips after first send
      document.getElementById('polly-chips').innerHTML = '';

      addMsg('u', text);
      inp.value = '';
      inp.style.height = 'auto';

      busy = true;
      document.getElementById('polly-btn').disabled = true;
      showTyping();

      var token   = localStorage.getItem('ps_token') || '';
      var headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = 'Bearer ' + token;

      // Re-read context at send time so it's always fresh
      var liveCtx = window.POLLY_CONTEXT || null;

      fetch('/api/chat', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          messages:     history.slice(-12),
          context_type: liveCtx ? liveCtx.type : null,
          context_id:   liveCtx ? liveCtx.id   : null
        })
      })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        hideTyping();
        if (data.error) { addMsg('a', 'Sorry, something went wrong: ' + data.error); }
        else            { addMsg('a', data.reply); }
      })
      .catch(function(err) {
        hideTyping();
        addMsg('a', 'Connection error. Please try again.');
      })
      .finally(function() {
        busy = false;
        document.getElementById('polly-btn').disabled = false;
      });
    }

    document.getElementById('polly-btn').addEventListener('click', send);
    document.getElementById('polly-inp').addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    document.getElementById('polly-inp').addEventListener('input', function() {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 100) + 'px';
    });

    /* ── Helpers ── */
    function scroll() {
      var el = document.getElementById('polly-msgs');
      if (el) el.scrollTop = el.scrollHeight;
    }

    function md(t) {
      return t
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/^#{1,3}\s+(.+)$/gm, '<strong>$1</strong>')
        .replace(/^[-•]\s+(.+)$/gm, '<li>$1</li>')
        .replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>')
        .replace(/\n\n+/g, '</p><p>')
        .replace(/\n/g, '<br>')
        .replace(/^(?!<[upo])/,'<p>').replace(/(?<![>])$/,'</p>')
        .replace(/<p><\/p>/g, '');
    }

  } // end mount

})();
