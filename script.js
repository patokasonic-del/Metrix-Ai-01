(() => {
  const STORAGE_KEY = 'metrix_ai_01_chats_v2';
  const NEW_CHAT_GREETING =
    "Hello! Welcome to **Metrix AI 01**. I'm here to help you with **Computer Programming** (loops, structures, strings, arrays, pointers, real-life examples & Kenyan university past papers), **Engineering Physics, Chemistry & Mathematics** (course outlines & university past exam questions), **Academic Writing** (past papers, formatting & research materials), and **Engineering Drawing** (clear diagrams with step-by-step explanations).\n\nHow can I help you today?";

  // DOM Elements
  const sidebar = document.getElementById('sidebar');
  const sidebarOverlay = document.getElementById('sidebarOverlay');
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  const newChatBtn = document.getElementById('newChatBtn');
  const chatHistoryList = document.getElementById('chatHistoryList');
  const chatContainer = document.getElementById('chatContainer');
  const welcomeScreen = document.getElementById('welcomeScreen');
  const messagesList = document.getElementById('messagesList');
  const suggestionsGrid = document.getElementById('suggestionsGrid');
  const messageInput = document.getElementById('messageInput');
  const sendBtn = document.getElementById('sendBtn');

  // State
  let chats = loadChats();
  let currentChatId = null;
  let isGenerating = false;

  // Initialize
  renderSidebar();
  startNewChat(false);

  // --- Storage Helpers ---
  function loadChats() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveChats() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(chats));
    } catch (err) {
      console.error('Failed to save chats to localStorage:', err);
    }
  }

  function getCurrentChat() {
    return chats.find((c) => c.id === currentChatId) || null;
  }

  // --- Time Formatting ---
  function formatTime(date = new Date()) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  // --- Safe HTML Escaping & SVG Sanitizer ---
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function sanitizeSvg(rawSvg) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(rawSvg, 'image/svg+xml');
    const svgEl = doc.querySelector('svg');
    if (!svgEl || doc.querySelector('parsererror')) {
      return null;
    }

    // Remove dangerous elements & event handlers
    const forbiddenTags = ['script', 'iframe', 'object', 'embed', 'foreignObject'];
    forbiddenTags.forEach((tag) => {
      svgEl.querySelectorAll(tag).forEach((el) => el.remove());
    });

    const walk = (node) => {
      if (node.nodeType === 1) {
        Array.from(node.attributes).forEach((attr) => {
          const name = attr.name.toLowerCase();
          const val = attr.value.trim().toLowerCase();
          if (name.startsWith('on') || (name === 'href' && val.startsWith('javascript:'))) {
            node.removeAttribute(attr.name);
          }
        });
      }
      Array.from(node.childNodes).forEach(walk);
    };
    walk(svgEl);

    if (!svgEl.getAttribute('viewBox')) {
      const w = parseFloat(svgEl.getAttribute('width')) || 640;
      const h = parseFloat(svgEl.getAttribute('height')) || 360;
      svgEl.setAttribute('viewBox', `0 0 ${w} ${h}`);
    }
    svgEl.removeAttribute('width');
    svgEl.removeAttribute('height');

    return svgEl.outerHTML;
  }

  function formatInlineMarkdown(escapedText) {
    // Inline code `...`
    let html = escapedText.replace(/`([^`\n]+)`/g, '<code class="inline-code">$1</code>');
    // Bold **...**
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    return html;
  }

  function renderMarkdown(rawText) {
    const codeBlocks = [];
    const svgBlocks = [];

    // Extract ```svg ... ``` engineering diagrams first
    let processed = String(rawText).replace(
      /```svg\s*\n([\s\S]*?)```/gi,
      (_, svgContent) => {
        const cleanSvg = sanitizeSvg(svgContent.trim());
        if (cleanSvg) {
          const idx = svgBlocks.length;
          svgBlocks.push(cleanSvg);
          return `@@SVGBLOCK_${idx}@@`;
        }
        const codeIdx = codeBlocks.length;
        codeBlocks.push({ lang: 'svg', code: svgContent.trim() });
        return `@@CODEBLOCK_${codeIdx}@@`;
      }
    );

    // Extract other fenced code blocks
    processed = processed.replace(
      /```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g,
      (_, lang, code) => {
        const index = codeBlocks.length;
        codeBlocks.push({
          lang: lang.trim() || 'code',
          code: code.replace(/\n$/, ''),
        });
        return `@@CODEBLOCK_${index}@@`;
      }
    );

    const lines = processed.split('\n');
    const output = [];
    let inUl = false;
    let inOl = false;

    const closeLists = () => {
      if (inUl) {
        output.push('</ul>');
        inUl = false;
      }
      if (inOl) {
        output.push('</ol>');
        inOl = false;
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // SVG Diagram Block Placeholder
      const svgMatch = trimmed.match(/^@@SVGBLOCK_(\d+)@@$/);
      if (svgMatch) {
        closeLists();
        const svgMarkup = svgBlocks[Number(svgMatch[1])];
        output.push(`
          <div class="diagram-block-wrapper">
            <div class="diagram-block-header">
              <span><i class="fa-solid fa-compass-drafting"></i> Engineering Drawing Diagram</span>
              <span>Technical View</span>
            </div>
            <div class="diagram-canvas">${svgMarkup}</div>
          </div>
        `);
        continue;
      }

      // Code Block Placeholder
      const codeMatch = trimmed.match(/^@@CODEBLOCK_(\d+)@@$/);
      if (codeMatch) {
        closeLists();
        const block = codeBlocks[Number(codeMatch[1])];
        const safeLang = escapeHtml(block.lang);
        const safeCode = escapeHtml(block.code);
        output.push(`
          <div class="code-block-wrapper">
            <div class="code-block-header">
              <span class="code-lang-label">${safeLang}</span>
              <button type="button" class="copy-code-btn" data-code-index="${codeMatch[1]}">
                <i class="fa-regular fa-copy"></i>
                <span>Copy code</span>
              </button>
            </div>
            <pre><code>${safeCode}</code></pre>
          </div>
        `);
        continue;
      }

      if (!trimmed) {
        closeLists();
        continue;
      }

      // Headings (#, ##, ###)
      const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
      if (headingMatch) {
        closeLists();
        const level = headingMatch[1].length;
        const content = formatInlineMarkdown(escapeHtml(headingMatch[2]));
        output.push(`<h${level}>${content}</h${level}>`);
        continue;
      }

      // Bullet list (- or *)
      const ulMatch = trimmed.match(/^[-*]\s+(.+)$/);
      if (ulMatch) {
        if (inOl) {
          output.push('</ol>');
          inOl = false;
        }
        if (!inUl) {
          output.push('<ul>');
          inUl = true;
        }
        output.push(`<li>${formatInlineMarkdown(escapeHtml(ulMatch[1]))}</li>`);
        continue;
      }

      // Numbered list (1. 2. etc.)
      const olMatch = trimmed.match(/^\d+\.\s+(.+)$/);
      if (olMatch) {
        if (inUl) {
          output.push('</ul>');
          inUl = false;
        }
        if (!inOl) {
          output.push('<ol>');
          inOl = true;
        }
        output.push(`<li>${formatInlineMarkdown(escapeHtml(olMatch[1]))}</li>`);
        continue;
      }

      // Regular paragraph
      closeLists();
      output.push(`<p>${formatInlineMarkdown(escapeHtml(line))}</p>`);
    }

    closeLists();

    const container = document.createElement('div');
    container.innerHTML = output.join('');

    container.querySelectorAll('.copy-code-btn').forEach((btn) => {
      const idx = Number(btn.getAttribute('data-code-index'));
      const rawCode = codeBlocks[idx]?.code || '';
      btn.addEventListener('click', () => {
        copyText(rawCode, () => {
          btn.innerHTML = '<i class="fa-solid fa-check"></i><span>Copied!</span>';
          setTimeout(() => {
            btn.innerHTML = '<i class="fa-regular fa-copy"></i><span>Copy code</span>';
          }, 1800);
        });
      });
    });

    return container;
  }

  function copyText(text, onSuccess) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(onSuccess).catch(() => fallbackCopy(text, onSuccess));
    } else {
      fallbackCopy(text, onSuccess);
    }
  }

  function fallbackCopy(text, onSuccess) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      if (onSuccess) onSuccess();
    } catch (e) {
      console.error('Copy failed', e);
    }
    document.body.removeChild(ta);
  }

  // --- UI Rendering ---
  function createAvatarElement() {
    const wrapper = document.createElement('div');
    wrapper.className = 'avatar-wrapper msg-avatar';

    const img = document.createElement('img');
    img.src = 'avatar.png';
    img.alt = 'Metrix AI 01';
    img.onerror = () => wrapper.classList.add('img-failed');

    const fallback = document.createElement('div');
    fallback.className = 'avatar-fallback';
    fallback.textContent = 'M';

    wrapper.appendChild(img);
    wrapper.appendChild(fallback);
    return wrapper;
  }

  function renderSidebar() {
    chatHistoryList.innerHTML = '';

    if (chats.length === 0) {
      const empty = document.createElement('div');
      empty.style.padding = '12px 10px';
      empty.style.fontSize = '0.82rem';
      empty.style.color = 'var(--text-muted)';
      empty.textContent = 'No saved chats yet.';
      chatHistoryList.appendChild(empty);
      return;
    }

    chats.forEach((chat) => {
      const item = document.createElement('div');
      item.className = `chat-history-item ${chat.id === currentChatId ? 'active' : ''}`;

      const titleWrap = document.createElement('div');
      titleWrap.className = 'chat-item-title';
      titleWrap.innerHTML = `<i class="fa-regular fa-message"></i><span>${escapeHtml(chat.title)}</span>`;

      const delBtn = document.createElement('button');
      delBtn.className = 'delete-chat-btn';
      delBtn.type = 'button';
      delBtn.title = 'Delete chat';
      delBtn.innerHTML = '<i class="fa-regular fa-trash-can"></i>';

      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteChat(chat.id);
      });

      item.addEventListener('click', () => {
        openChat(chat.id);
        closeMobileSidebar();
      });

      item.appendChild(titleWrap);
      item.appendChild(delBtn);
      chatHistoryList.appendChild(item);
    });
  }

  function renderMessages() {
    messagesList.innerHTML = '';
    const chat = getCurrentChat();

    if (!chat || chat.messages.length === 0) {
      welcomeScreen.classList.remove('hidden');
      return;
    }

    // Show welcome card banner above messages only when chat has just the initial greeting
    const hasUserMessage = chat.messages.some((m) => m.role === 'user');
    if (!hasUserMessage) {
      welcomeScreen.classList.remove('hidden');
    } else {
      welcomeScreen.classList.add('hidden');
    }

    chat.messages.forEach((msg, idx) => {
      appendMessageToDOM(msg, idx);
    });
    scrollToBottom();
  }

  function appendMessageToDOM(msg, msgIndex) {
    const row = document.createElement('div');
    row.className = `message-row ${msg.role}`;

    if (msg.role === 'user') {
      const bubble = document.createElement('div');
      bubble.className = 'user-bubble';
      bubble.textContent = msg.content;
      row.appendChild(bubble);
    } else {
      const avatar = createAvatarElement();
      const contentWrap = document.createElement('div');
      contentWrap.className = 'assistant-content-wrap';

      const bubble = document.createElement('div');
      bubble.className = `assistant-bubble ${msg.isError ? 'error-bubble' : ''}`;
      bubble.appendChild(renderMarkdown(msg.content));

      // Action Bar
      const actionBar = document.createElement('div');
      actionBar.className = 'message-actions';

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'action-btn';
      copyBtn.innerHTML = '<i class="fa-regular fa-copy"></i><span>Copy</span>';
      copyBtn.addEventListener('click', () => {
        copyText(msg.content, () => {
          copyBtn.innerHTML = '<i class="fa-solid fa-check"></i><span>Copied</span>';
          setTimeout(() => {
            copyBtn.innerHTML = '<i class="fa-regular fa-copy"></i><span>Copy</span>';
          }, 1800);
        });
      });

      const timeSpan = document.createElement('span');
      timeSpan.className = 'msg-timestamp';
      timeSpan.textContent = msg.time || formatTime();

      const upBtn = document.createElement('button');
      upBtn.type = 'button';
      upBtn.className = `action-btn ${msg.feedback === 'up' ? 'active-like' : ''}`;
      upBtn.title = 'Helpful';
      upBtn.innerHTML = '<i class="fa-regular fa-thumbs-up"></i>';

      const downBtn = document.createElement('button');
      downBtn.type = 'button';
      downBtn.className = `action-btn ${msg.feedback === 'down' ? 'active-dislike' : ''}`;
      downBtn.title = 'Not helpful';
      downBtn.innerHTML = '<i class="fa-regular fa-thumbs-down"></i>';

      upBtn.addEventListener('click', () => {
        const nextFeedback = msg.feedback === 'up' ? null : 'up';
        updateMessageFeedback(msgIndex, nextFeedback);
        upBtn.classList.toggle('active-like', nextFeedback === 'up');
        downBtn.classList.remove('active-dislike');
      });

      downBtn.addEventListener('click', () => {
        const nextFeedback = msg.feedback === 'down' ? null : 'down';
        updateMessageFeedback(msgIndex, nextFeedback);
        downBtn.classList.toggle('active-dislike', nextFeedback === 'down');
        upBtn.classList.remove('active-like');
      });

      actionBar.appendChild(copyBtn);
      actionBar.appendChild(timeSpan);
      actionBar.appendChild(upBtn);
      actionBar.appendChild(downBtn);

      contentWrap.appendChild(bubble);
      contentWrap.appendChild(actionBar);
      row.appendChild(avatar);
      row.appendChild(contentWrap);
    }

    messagesList.appendChild(row);
  }

  function updateMessageFeedback(msgIndex, feedback) {
    const chat = getCurrentChat();
    if (chat && chat.messages[msgIndex]) {
      chat.messages[msgIndex].feedback = feedback;
      saveChats();
    }
  }

  function showTypingIndicator() {
    const row = document.createElement('div');
    row.className = 'message-row assistant';
    row.id = 'typingIndicatorRow';

    const avatar = createAvatarElement();
    const contentWrap = document.createElement('div');
    contentWrap.className = 'assistant-content-wrap';

    const bubble = document.createElement('div');
    bubble.className = 'assistant-bubble';
    bubble.innerHTML = `
      <div class="typing-dots" aria-label="Metrix AI 01 is typing">
        <span></span><span></span><span></span>
      </div>
    `;

    contentWrap.appendChild(bubble);
    row.appendChild(avatar);
    row.appendChild(contentWrap);
    messagesList.appendChild(row);
    scrollToBottom();
  }

  function removeTypingIndicator() {
    const indicator = document.getElementById('typingIndicatorRow');
    if (indicator) indicator.remove();
  }

  function scrollToBottom() {
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }

  // --- Chat Lifecycle ---
  function startNewChat(closeSidebar = true) {
    if (isGenerating) return;

    // Reuse an existing untouched greeting-only chat if one is currently active
    const activeChat = getCurrentChat();
    if (activeChat && activeChat.messages.length === 1 && activeChat.messages[0].isGreeting) {
      renderSidebar();
      renderMessages();
      if (closeSidebar) closeMobileSidebar();
      messageInput.focus();
      return;
    }

    const newChat = {
      id: 'chat_' + Date.now(),
      title: 'New Study Session',
      messages: [
        {
          role: 'assistant',
          content: NEW_CHAT_GREETING,
          time: formatTime(),
          feedback: null,
          isGreeting: true,
        },
      ],
    };

    chats.unshift(newChat);
    currentChatId = newChat.id;
    saveChats();

    renderSidebar();
    renderMessages();
    messageInput.value = '';
    autoResizeInput();
    updateSendButtonState();
    if (closeSidebar) closeMobileSidebar();
    messageInput.focus();
  }

  function openChat(chatId) {
    if (isGenerating) return;
    currentChatId = chatId;
    renderSidebar();
    renderMessages();
  }

  function deleteChat(chatId) {
    chats = chats.filter((c) => c.id !== chatId);
    saveChats();
    if (currentChatId === chatId) {
      currentChatId = chats.length > 0 ? chats[0].id : null;
    }
    if (!currentChatId) {
      startNewChat(false);
    } else {
      renderSidebar();
      renderMessages();
    }
  }

  // --- Sending Messages ---
  async function handleSendMessage(overrideText = null) {
    if (isGenerating) return;

    const text = (overrideText !== null ? overrideText : messageInput.value).trim();
    if (!text) return;

    let chat = getCurrentChat();
    if (!chat) {
      chat = {
        id: 'chat_' + Date.now(),
        title: 'New Study Session',
        messages: [],
      };
      chats.unshift(chat);
      currentChatId = chat.id;
    }

    // Set chat title from the first real user prompt
    const hasPriorUserMsg = chat.messages.some((m) => m.role === 'user');
    if (!hasPriorUserMsg) {
      chat.title = text.length > 36 ? text.slice(0, 36) + '...' : text;
    }

    const userMsg = {
      role: 'user',
      content: text,
      time: formatTime(),
    };
    chat.messages.push(userMsg);
    saveChats();

    messageInput.value = '';
    autoResizeInput();
    updateSendButtonState();
    welcomeScreen.classList.add('hidden');
    appendMessageToDOM(userMsg, chat.messages.length - 1);
    renderSidebar();
    scrollToBottom();

    isGenerating = true;
    updateSendButtonState();
    showTypingIndicator();

    try {
      const apiMessages = chat.messages
        .filter((m) => !m.isError && !m.isGreeting && (m.role === 'user' || m.role === 'assistant'))
        .map((m) => ({ role: m.role, content: m.content }));

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages }),
      });

      const data = await response.json().catch(() => ({}));
      removeTypingIndicator();

      if (!response.ok || !data.reply) {
        const errText = data.error || 'Something went wrong while contacting Metrix AI 01. Please try again.';
        const errMsg = {
          role: 'assistant',
          content: errText,
          time: formatTime(),
          isError: true,
          feedback: null,
        };
        chat.messages.push(errMsg);
        saveChats();
        appendMessageToDOM(errMsg, chat.messages.length - 1);
      } else {
        const aiMsg = {
          role: 'assistant',
          content: data.reply,
          time: formatTime(),
          feedback: null,
        };
        chat.messages.push(aiMsg);
        saveChats();
        appendMessageToDOM(aiMsg, chat.messages.length - 1);
      }
    } catch (err) {
      removeTypingIndicator();
      const networkErrMsg = {
        role: 'assistant',
        content: 'Network error: Could not reach the server. Please check your connection and try again.',
        time: formatTime(),
        isError: true,
        feedback: null,
      };
      chat.messages.push(networkErrMsg);
      saveChats();
      appendMessageToDOM(networkErrMsg, chat.messages.length - 1);
    } finally {
      isGenerating = false;
      updateSendButtonState();
      scrollToBottom();
    }
  }

  // --- Input & Sidebar Controls ---
  function autoResizeInput() {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 160) + 'px';
  }

  function updateSendButtonState() {
    sendBtn.disabled = isGenerating || messageInput.value.trim().length === 0;
  }

  function openMobileSidebar() {
    sidebar.classList.add('open');
    sidebarOverlay.classList.add('active');
  }

  function closeMobileSidebar() {
    sidebar.classList.remove('open');
    sidebarOverlay.classList.remove('active');
  }

  // Event Listeners
  messageInput.addEventListener('input', () => {
    autoResizeInput();
    updateSendButtonState();
  });

  messageInput.addEventListener('keydown', (e) => {
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    if (e.key === 'Enter' && !e.shiftKey && !isMobile) {
      e.preventDefault();
      handleSendMessage();
    }
  });

  sendBtn.addEventListener('click', () => handleSendMessage());
  newChatBtn.addEventListener('click', () => startNewChat(true));
  mobileMenuBtn.addEventListener('click', openMobileSidebar);
  sidebarOverlay.addEventListener('click', closeMobileSidebar);

  suggestionsGrid.querySelectorAll('.suggestion-card').forEach((card) => {
    card.addEventListener('click', () => {
      const prompt = card.getAttribute('data-prompt');
      if (prompt) handleSendMessage(prompt);
    });
  });
})();
