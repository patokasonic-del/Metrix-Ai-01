(() => {
  const SESSION_KEY = 'metrix_ai_01_session_v1';
  const CHATS_KEY = 'metrix_ai_01_chats_by_unit_v1';
  const USAGE_KEY = 'metrix_ai_01_usage_v1';
  const VOICE_PREF_KEY = 'metrix_ai_01_voice_reply_v1';
  const FREE_QUESTION_LIMIT = 10;
  const PASS_DURATION_MS = 24 * 60 * 60 * 1000;
  const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

  // Auth & Unit Gate Elements
  const authScreen = document.getElementById('authScreen');
  const authForm = document.getElementById('authForm');
  const authError = document.getElementById('authError');
  const studentEmailInput = document.getElementById('studentEmail');
  const studentPasswordInput = document.getElementById('studentPassword');
  const togglePasswordBtn = document.getElementById('togglePasswordBtn');
  const passwordStrengthBar = document.getElementById('passwordStrengthBar');
  const passwordStrengthText = document.getElementById('passwordStrengthText');

  const unitScreen = document.getElementById('unitScreen');
  const signedInEmailLabel = document.getElementById('signedInEmailLabel');
  const signOutBtn = document.getElementById('signOutBtn');
  const unitsGrid = document.getElementById('unitsGrid');
  const customUnitBox = document.getElementById('customUnitBox');
  const customUnitInput = document.getElementById('customUnitInput');
  const confirmCustomUnitBtn = document.getElementById('confirmCustomUnitBtn');

  // Chat Workspace Elements
  const chatApp = document.getElementById('chatApp');
  const sidebar = document.getElementById('sidebar');
  const sidebarOverlay = document.getElementById('sidebarOverlay');
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  const sidebarSignOutBtn = document.getElementById('sidebarSignOutBtn');
  const switchUnitBtn = document.getElementById('switchUnitBtn');
  const activeUnitText = document.getElementById('activeUnitText');
  const welcomeSubtitle = document.getElementById('welcomeSubtitle');
  const newChatBtn = document.getElementById('newChatBtn');
  const chatHistoryList = document.getElementById('chatHistoryList');
  const chatContainer = document.getElementById('chatContainer');
  const welcomeScreen = document.getElementById('welcomeScreen');
  const messagesList = document.getElementById('messagesList');
  const suggestionsGrid = document.getElementById('suggestionsGrid');
  const messageInput = document.getElementById('messageInput');
  const sendBtn = document.getElementById('sendBtn');

  // Photo Attachment Elements
  const photoAttachBtn = document.getElementById('photoAttachBtn');
  const photoPickerMenu = document.getElementById('photoPickerMenu');
  const takePhotoOptionBtn = document.getElementById('takePhotoOptionBtn');
  const chooseGalleryOptionBtn = document.getElementById('chooseGalleryOptionBtn');
  const galleryFileInput = document.getElementById('galleryFileInput');
  const cameraFileInput = document.getElementById('cameraFileInput');
  const attachmentPreviewBar = document.getElementById('attachmentPreviewBar');
  const attachmentThumbImg = document.getElementById('attachmentThumbImg');
  const attachmentFileName = document.getElementById('attachmentFileName');
  const removeAttachmentBtn = document.getElementById('removeAttachmentBtn');

  // Voice Input & Spoken Reply Elements
  const micVoiceBtn = document.getElementById('micVoiceBtn');
  const micVoiceIcon = document.getElementById('micVoiceIcon');
  const voiceStatusBanner = document.getElementById('voiceStatusBanner');
  const voiceStatusText = document.getElementById('voiceStatusText');
  const stopVoiceBannerBtn = document.getElementById('stopVoiceBannerBtn');
  const voiceReplyToggleBtn = document.getElementById('voiceReplyToggleBtn');
  const voiceReplyIcon = document.getElementById('voiceReplyIcon');
  const voiceReplyStateText = document.getElementById('voiceReplyStateText');

  // Payment Modal Elements
  const paymentModal = document.getElementById('paymentModal');
  const closePaymentModalBtn = document.getElementById('closePaymentModalBtn');
  const paymentForm = document.getElementById('paymentForm');
  const mpesaPhoneInput = document.getElementById('mpesaPhoneInput');
  const payNowBtn = document.getElementById('payNowBtn');
  const verifyPaymentBtn = document.getElementById('verifyPaymentBtn');
  const paymentStatusMsg = document.getElementById('paymentStatusMsg');

  // Application State
  let session = loadSession();
  let chatsByUnit = loadChatsByUnit();
  let usageMap = loadUsageMap();
  let currentChatId = null;
  let isGenerating = false;
  let pendingPayload = null;
  let selectedAttachment = null;
  let recognition = null;
  let isListening = false;
  let voiceReplyEnabled = loadVoiceReplyPref();

  // Boot Flow
  initSpeechRecognition();
  updateVoiceReplyToggleUI();
  syncViewState();
  if (session?.email) {
    syncStudentFromSupabase();
  }

  // --- Session, Chat & Usage Storage Helpers ---
  function loadSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function saveSession() {
    try {
      if (session) {
        localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      } else {
        localStorage.removeItem(SESSION_KEY);
      }
    } catch (err) {
      console.error('Failed to save session:', err);
    }
  }

  function loadChatsByUnit() {
    try {
      const raw = localStorage.getItem(CHATS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function saveChatsByUnit() {
    try {
      localStorage.setItem(CHATS_KEY, JSON.stringify(chatsByUnit));
    } catch (err) {
      console.error('Failed to save chats:', err);
    }
  }

  function loadUsageMap() {
    try {
      const raw = localStorage.getItem(USAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function saveUsageMap() {
    try {
      localStorage.setItem(USAGE_KEY, JSON.stringify(usageMap));
    } catch (err) {
      console.error('Failed to save usage data:', err);
    }
  }

  function loadVoiceReplyPref() {
    try {
      return localStorage.getItem(VOICE_PREF_KEY) === 'true';
    } catch {
      return false;
    }
  }

  function saveVoiceReplyPref(val) {
    try {
      localStorage.setItem(VOICE_PREF_KEY, val ? 'true' : 'false');
    } catch {
      // Ignore storage error
    }
  }

  function getUserUsage() {
    const emailKey = (session?.email || 'guest').toLowerCase();
    if (!usageMap[emailKey]) {
      usageMap[emailKey] = {
        questionsUsed: 0,
        passExpiresAt: 0,
        lastCheckoutId: '',
      };
    }
    return usageMap[emailKey];
  }

  function applyServerUsage(email, questionsUsed, passExpiresAt) {
    const emailKey = String(email || session?.email || 'guest').toLowerCase();
    const current = getUserUsage();
    usageMap[emailKey] = {
      ...current,
      questionsUsed: typeof questionsUsed === 'number' ? questionsUsed : current.questionsUsed,
      passExpiresAt: typeof passExpiresAt === 'number' ? passExpiresAt : current.passExpiresAt,
    };
    saveUsageMap();
  }

  async function syncStudentFromSupabase() {
    if (!session?.email) return;
    try {
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'sync',
          email: session.email,
        }),
      });
      const data = await response.json().catch(() => null);
      if (response.ok && data?.student) {
        applyServerUsage(
          data.student.email,
          data.student.questionsUsed,
          data.student.passExpiresAt
        );
      }
    } catch {
      // Offline fallback uses cached usageMap
    }
  }

  function hasActive24hPass() {
    const usage = getUserUsage();
    return typeof usage.passExpiresAt === 'number' && usage.passExpiresAt > Date.now();
  }

  function canAskQuestion() {
    if (hasActive24hPass()) return true;
    const usage = getUserUsage();
    return (usage.questionsUsed || 0) < FREE_QUESTION_LIMIT;
  }

  function activate24hPass(checkoutId = '') {
    const usage = getUserUsage();
    usage.passExpiresAt = Date.now() + PASS_DURATION_MS;
    if (checkoutId) usage.lastCheckoutId = checkoutId;
    saveUsageMap();
  }

  function getUnitChats() {
    const unit = session?.selectedUnit || 'General Studies';
    if (!Array.isArray(chatsByUnit[unit])) {
      chatsByUnit[unit] = [];
    }
    return chatsByUnit[unit];
  }

  function getCurrentChat() {
    const list = getUnitChats();
    return list.find((c) => c.id === currentChatId) || null;
  }

  function buildUnitGreeting() {
    return 'Welcome to Matrix AI! What can I help you with today?';
  }

  // --- Image Processing & Compression ---
  function processSelectedImageFile(file) {
    if (!file) return;
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      showVoiceOrInputNotice('Please select a JPEG, PNG, or WebP image.', true);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const MAX_DIMENSION = 1280;
        let { width, height } = img;

        if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
          if (width > height) {
            height = Math.round((height * MAX_DIMENSION) / width);
            width = MAX_DIMENSION;
          } else {
            width = Math.round((width * MAX_DIMENSION) / height);
            height = MAX_DIMENSION;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const outputMime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        const quality = outputMime === 'image/png' ? undefined : 0.84;
        const dataUrl = canvas.toDataURL(outputMime, quality);
        const base64 = dataUrl.split(',')[1] || '';

        selectedAttachment = {
          base64,
          mimeType: outputMime,
          previewUrl: dataUrl,
          fileName: file.name || 'photo.jpg',
        };

        attachmentThumbImg.src = dataUrl;
        attachmentFileName.textContent = selectedAttachment.fileName;
        attachmentPreviewBar.classList.remove('hidden');
        updateSendButtonState();
        messageInput.focus();
      };
      img.onerror = () => {
        showVoiceOrInputNotice('Could not read the selected image. Try another photo.', true);
      };
      img.src = reader.result;
    };
    reader.onerror = () => {
      showVoiceOrInputNotice('Failed to load image file.', true);
    };
    reader.readAsDataURL(file);
  }

  function clearSelectedAttachment() {
    selectedAttachment = null;
    attachmentThumbImg.src = '';
    attachmentFileName.textContent = '';
    attachmentPreviewBar.classList.add('hidden');
    galleryFileInput.value = '';
    cameraFileInput.value = '';
    updateSendButtonState();
  }

  // --- Speech Recognition & Speech Synthesis ---
  function showVoiceOrInputNotice(message, isError = false, showStop = false) {
    voiceStatusText.textContent = message;
    voiceStatusBanner.classList.remove('hidden', 'error');
    if (isError) voiceStatusBanner.classList.add('error');
    stopVoiceBannerBtn.classList.toggle('hidden', !showStop);
  }

  function hideVoiceOrInputNotice() {
    voiceStatusBanner.classList.add('hidden');
  }

  function initSpeechRecognition() {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      recognition = null;
      return;
    }

    recognition = new SpeechRec();
    recognition.lang = 'en-KE';
    recognition.interimResults = true;
    recognition.continuous = false;

    let baseTextBeforeSpeech = '';

    recognition.onstart = () => {
      isListening = true;
      baseTextBeforeSpeech = messageInput.value.trim();
      micVoiceBtn.classList.add('listening');
      micVoiceIcon.className = 'fa-solid fa-stop';
      showVoiceOrInputNotice('Listening... Speak your question clearly.', false, true);
    };

    recognition.onresult = (event) => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      const cleanTranscript = transcript.trim();
      messageInput.value = baseTextBeforeSpeech
        ? `${baseTextBeforeSpeech} ${cleanTranscript}`
        : cleanTranscript;
      autoResizeInput();
      updateSendButtonState();
    };

    recognition.onerror = (event) => {
      isListening = false;
      micVoiceBtn.classList.remove('listening');
      micVoiceIcon.className = 'fa-solid fa-microphone';
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        showVoiceOrInputNotice('Microphone permission blocked. Allow mic access in your browser settings.', true, false);
      } else if (event.error === 'no-speech') {
        showVoiceOrInputNotice('No speech detected. Tap the mic and try again.', true, false);
      } else {
        showVoiceOrInputNotice(`Voice input error (${event.error}). You can type your question instead.`, true, false);
      }
    };

    recognition.onend = () => {
      isListening = false;
      micVoiceBtn.classList.remove('listening');
      micVoiceIcon.className = 'fa-solid fa-microphone';
      if (!voiceStatusBanner.classList.contains('error')) {
        hideVoiceOrInputNotice();
      }
      messageInput.focus();
    };
  }

  function toggleMicrophoneListening() {
    stopSpeaking();

    if (!recognition) {
      showVoiceOrInputNotice('Voice input is not supported in this browser. Try Chrome or Edge.', true, false);
      return;
    }

    if (isListening) {
      try {
        recognition.stop();
      } catch {
        // Ignore
      }
      return;
    }

    hideVoiceOrInputNotice();
    try {
      recognition.start();
    } catch {
      showVoiceOrInputNotice('Unable to start microphone right now. Please try again.', true, false);
    }
  }

  function updateVoiceReplyToggleUI() {
    voiceReplyToggleBtn.classList.toggle('active', voiceReplyEnabled);
    voiceReplyToggleBtn.setAttribute('aria-pressed', voiceReplyEnabled ? 'true' : 'false');
    voiceReplyIcon.className = voiceReplyEnabled ? 'fa-solid fa-volume-high' : 'fa-solid fa-volume-xmark';
    voiceReplyStateText.textContent = voiceReplyEnabled ? 'On' : 'Off';
  }

  function stopSpeaking() {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }

  function cleanTextForSpeech(rawText) {
    return String(rawText || '')
      .replace(/```svg[\s\S]*?```/gi, 'Technical diagram shown on screen.')
      .replace(/```[\s\S]*?```/g, 'Code example shown on screen.')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^[-*•]\s+/gm, '')
      .replace(/\n{2,}/g, '. ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function speakAssistantReply(rawText) {
    if (!voiceReplyEnabled || !('speechSynthesis' in window)) return;
    stopSpeaking();

    const spokenText = cleanTextForSpeech(rawText);
    if (!spokenText) return;

    const utterance = new SpeechSynthesisUtterance(spokenText);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    window.speechSynthesis.speak(utterance);
  }

  // --- Password Strength & Validation ---
  function evaluatePassword(password) {
    const checks = {
      length: password.length >= 8,
      upper: /[A-Z]/.test(password),
      lower: /[a-z]/.test(password),
      number: /[0-9]/.test(password),
      special: /[^A-Za-z0-9]/.test(password),
    };
    const score = Object.values(checks).filter(Boolean).length;
    return { checks, score, isStrong: Object.values(checks).every(Boolean) };
  }

  function updatePasswordMeter() {
    const val = studentPasswordInput.value;
    const { score, isStrong } = evaluatePassword(val);
    const percent = Math.min(100, (score / 5) * 100);
    passwordStrengthBar.style.width = `${percent}%`;

    if (!val) {
      passwordStrengthBar.style.backgroundColor = '#334155';
      passwordStrengthText.textContent =
        'Use 8+ characters with uppercase, lowercase, a number, and a special character.';
      passwordStrengthText.style.color = 'var(--text-muted)';
      return;
    }

    if (score <= 2) {
      passwordStrengthBar.style.backgroundColor = '#ef4444';
      passwordStrengthText.textContent = 'Weak password — add 8+ chars, upper/lowercase, number & symbol.';
      passwordStrengthText.style.color = '#fca5a5';
    } else if (score < 5 || !isStrong) {
      passwordStrengthBar.style.backgroundColor = '#f59e0b';
      passwordStrengthText.textContent = 'Moderate password — include all 5 requirements for a strong password.';
      passwordStrengthText.style.color = '#fcd34d';
    } else {
      passwordStrengthBar.style.backgroundColor = '#10b981';
      passwordStrengthText.textContent = 'Strong password ready.';
      passwordStrengthText.style.color = '#6ee7b7';
    }
  }

  function showAuthError(msg) {
    authError.textContent = msg;
    authError.classList.remove('hidden');
  }

  function clearAuthError() {
    authError.textContent = '';
    authError.classList.add('hidden');
  }

  // --- Screen Navigation ---
  function syncViewState() {
    if (!session || !session.email) {
      authScreen.classList.remove('hidden');
      unitScreen.classList.add('hidden');
      chatApp.classList.add('hidden');
      return;
    }

    if (!session.selectedUnit) {
      authScreen.classList.add('hidden');
      unitScreen.classList.remove('hidden');
      chatApp.classList.add('hidden');
      signedInEmailLabel.textContent = `Signed in: ${session.email}`;
      customUnitBox.classList.add('hidden');
      customUnitInput.value = '';
      return;
    }

    authScreen.classList.add('hidden');
    unitScreen.classList.add('hidden');
    chatApp.classList.remove('hidden');

    activeUnitText.textContent = session.selectedUnit;
    welcomeSubtitle.textContent = 'Welcome to Matrix AI! What can I help you with today?';

    const unitChats = getUnitChats();
    if (!unitChats.some((c) => c.id === currentChatId)) {
      currentChatId = unitChats.length > 0 ? unitChats[0].id : null;
    }

    renderSidebar();
    if (!currentChatId) {
      startNewChat(false);
    } else {
      renderMessages();
    }
  }

  async function selectUnitAndOpenChat(unitName) {
    const cleanUnit = String(unitName || '').trim();
    if (!cleanUnit) return;
    session.selectedUnit = cleanUnit;
    saveSession();
    currentChatId = null;
    syncViewState();
    messageInput.focus();

    if (session?.email) {
      fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_unit',
          email: session.email,
          selectedUnit: cleanUnit,
        }),
      }).catch(() => null);
    }
  }

  function signOutUser() {
    if (isGenerating) return;
    stopSpeaking();
    clearSelectedAttachment();
    session = null;
    currentChatId = null;
    pendingPayload = null;
    closePaymentModal();
    saveSession();
    closeMobileSidebar();
    studentEmailInput.value = '';
    studentPasswordInput.value = '';
    updatePasswordMeter();
    clearAuthError();
    syncViewState();
  }

  // --- Payment Modal Helpers (10 KES for 24h Access) ---
  function openPaymentModal(queuedPayload = null) {
    if (queuedPayload) {
      pendingPayload = queuedPayload;
    }
    setPaymentStatus('', '');
    paymentModal.classList.remove('hidden');
    mpesaPhoneInput.focus();
  }

  function closePaymentModal() {
    paymentModal.classList.add('hidden');
  }

  function setPaymentStatus(message, type = '') {
    if (!message) {
      paymentStatusMsg.textContent = '';
      paymentStatusMsg.className = 'payment-status-msg hidden';
      return;
    }
    paymentStatusMsg.textContent = message;
    paymentStatusMsg.className = `payment-status-msg ${type}`.trim();
  }

  function normalizeKenyanPhone(rawPhone) {
    const digits = String(rawPhone || '').replace(/\D/g, '');
    if (/^254[17]\d{8}$/.test(digits)) return digits;
    if (/^0[17]\d{8}$/.test(digits)) return '254' + digits.slice(1);
    if (/^[17]\d{8}$/.test(digits)) return '254' + digits;
    return null;
  }

  async function initiateTenBobPayment(e) {
    e.preventDefault();
    const normalizedPhone = normalizeKenyanPhone(mpesaPhoneInput.value);
    if (!normalizedPhone) {
      setPaymentStatus('Enter a valid Kenyan M-Pesa number (e.g., 07XXXXXXXX or 2547XXXXXXXX).', 'error');
      mpesaPhoneInput.focus();
      return;
    }

    payNowBtn.disabled = true;
    verifyPaymentBtn.disabled = true;
    setPaymentStatus('Sending 10 KES M-Pesa prompt to your phone...', '');

    try {
      const response = await fetch('/api/pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: normalizedPhone,
          amount: 10,
          email: session?.email || '',
          selectedUnit: session?.selectedUnit || '',
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setPaymentStatus(
          data.error || 'Could not initiate the 10 KES payment prompt. Please try again.',
          'error'
        );
      } else {
        if (data.checkoutRequestId) {
          const usage = getUserUsage();
          usage.lastCheckoutId = data.checkoutRequestId;
          saveUsageMap();
        }
        setPaymentStatus(
          data.message || 'Check your phone for the 10 KES M-Pesa PIN prompt, enter your PIN, then click "I Have Paid — Verify Payment".',
          'success'
        );
      }
    } catch {
      setPaymentStatus('Network error while starting payment. Check your connection and try again.', 'error');
    } finally {
      payNowBtn.disabled = false;
      verifyPaymentBtn.disabled = false;
    }
  }

  async function verifyTenBobPayment() {
    const usage = getUserUsage();
    const normalizedPhone = normalizeKenyanPhone(mpesaPhoneInput.value);

    payNowBtn.disabled = true;
    verifyPaymentBtn.disabled = true;
    setPaymentStatus('Verifying your 10 KES payment for 24-hour access...', '');

    try {
      const response = await fetch('/api/verify-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: session?.email || '',
          phone: normalizedPhone || '',
          checkoutRequestId: usage.lastCheckoutId || '',
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (response.ok && data.paid) {
        const expiresAt = data.passExpiresAt || Date.now() + PASS_DURATION_MS;
        applyServerUsage(session?.email, usage.questionsUsed, expiresAt);
        activate24hPass(data.checkoutRequestId || usage.lastCheckoutId || '');
        setPaymentStatus('Payment verified! Your 24-hour access is now active.', 'success');

        const queued = pendingPayload;
        pendingPayload = null;

        setTimeout(() => {
          closePaymentModal();
          if (queued) {
            handleSendMessage(queued.text, queued.attachment);
          }
        }, 650);
      } else {
        setPaymentStatus(
          data.error || 'Payment not confirmed yet. Complete the 10 KES prompt on your phone and try again.',
          'error'
        );
      }
    } catch {
      setPaymentStatus('Network error while verifying payment. Please try again.', 'error');
    } finally {
      payNowBtn.disabled = false;
      verifyPaymentBtn.disabled = false;
    }
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
    let html = escapedText.replace(/`([^`\n]+)`/g, '<code class="inline-code">$1</code>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    return html;
  }

  function renderMarkdown(rawText) {
    const codeBlocks = [];
    const svgBlocks = [];

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

      const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
      if (headingMatch) {
        closeLists();
        const level = headingMatch[1].length;
        const content = formatInlineMarkdown(escapeHtml(headingMatch[2]));
        output.push(`<h${level}>${content}</h${level}>`);
        continue;
      }

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
    img.alt = 'Matrix AI';
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
    const unitChats = getUnitChats();

    if (unitChats.length === 0) {
      const empty = document.createElement('div');
      empty.style.padding = '12px 10px';
      empty.style.fontSize = '0.82rem';
      empty.style.color = 'var(--text-muted)';
      empty.textContent = 'No saved chats for this unit yet.';
      chatHistoryList.appendChild(empty);
      return;
    }

    unitChats.forEach((chat) => {
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

      if (msg.imageUrl) {
        const imgEl = document.createElement('img');
        imgEl.src = msg.imageUrl;
        imgEl.alt = 'Uploaded study image';
        imgEl.className = 'user-bubble-image';
        bubble.appendChild(imgEl);
      }

      if (msg.content) {
        const textNode = document.createElement('div');
        textNode.textContent = msg.content;
        bubble.appendChild(textNode);
      }

      row.appendChild(bubble);
    } else {
      const avatar = createAvatarElement();
      const contentWrap = document.createElement('div');
      contentWrap.className = 'assistant-content-wrap';

      const bubble = document.createElement('div');
      bubble.className = `assistant-bubble ${msg.isError ? 'error-bubble' : ''}`;
      bubble.appendChild(renderMarkdown(msg.content));

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

      const speakBtn = document.createElement('button');
      speakBtn.type = 'button';
      speakBtn.className = 'action-btn';
      speakBtn.title = 'Read reply aloud';
      speakBtn.innerHTML = '<i class="fa-solid fa-volume-high"></i><span>Listen</span>';
      speakBtn.addEventListener('click', () => {
        if ('speechSynthesis' in window) {
          stopSpeaking();
          const spokenText = cleanTextForSpeech(msg.content);
          if (spokenText) {
            window.speechSynthesis.speak(new SpeechSynthesisUtterance(spokenText));
          }
        }
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
      actionBar.appendChild(speakBtn);
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
      saveChatsByUnit();
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
      <div class="typing-dots" aria-label="Matrix AI is typing">
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
    stopSpeaking();
    const unitName = session?.selectedUnit || 'General Studies';
    const unitChats = getUnitChats();

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
      title: `${unitName} Session`,
      messages: [
        {
          role: 'assistant',
          content: buildUnitGreeting(),
          time: formatTime(),
          feedback: null,
          isGreeting: true,
        },
      ],
    };

    unitChats.unshift(newChat);
    currentChatId = newChat.id;
    saveChatsByUnit();

    renderSidebar();
    renderMessages();
    messageInput.value = '';
    clearSelectedAttachment();
    autoResizeInput();
    updateSendButtonState();
    if (closeSidebar) closeMobileSidebar();
    messageInput.focus();
  }

  function openChat(chatId) {
    if (isGenerating) return;
    stopSpeaking();
    currentChatId = chatId;
    renderSidebar();
    renderMessages();
  }

  function deleteChat(chatId) {
    const unit = session?.selectedUnit || 'General Studies';
    chatsByUnit[unit] = getUnitChats().filter((c) => c.id !== chatId);
    saveChatsByUnit();

    if (currentChatId === chatId) {
      const remaining = getUnitChats();
      currentChatId = remaining.length > 0 ? remaining[0].id : null;
    }

    if (!currentChatId) {
      startNewChat(false);
    } else {
      renderSidebar();
      renderMessages();
    }
  }

  // --- Sending Messages ---
  async function handleSendMessage(overrideText = null, overrideAttachment = null) {
    if (isGenerating) return;

    if (isListening && recognition) {
      try {
        recognition.stop();
      } catch {
        // Ignore
      }
    }
    stopSpeaking();

    const text = (overrideText !== null ? overrideText : messageInput.value).trim();
    const attachmentToSend = overrideAttachment !== null ? overrideAttachment : selectedAttachment;

    if (!text && !attachmentToSend) return;

    if (!canAskQuestion()) {
      openPaymentModal({ text, attachment: attachmentToSend });
      return;
    }

    let chat = getCurrentChat();
    const unitChats = getUnitChats();
    if (!chat) {
      chat = {
        id: 'chat_' + Date.now(),
        title: 'Study Session',
        messages: [],
      };
      unitChats.unshift(chat);
      currentChatId = chat.id;
    }

    const displayUserText = text || 'Analyze this image and answer based on the selected unit.';
    const hasPriorUserMsg = chat.messages.some((m) => m.role === 'user');
    if (!hasPriorUserMsg) {
      const titleSource = text || 'Image Question';
      chat.title = titleSource.length > 36 ? titleSource.slice(0, 36) + '...' : titleSource;
    }

    const userMsg = {
      role: 'user',
      content: displayUserText,
      imageUrl: attachmentToSend ? attachmentToSend.previewUrl : null,
      time: formatTime(),
    };
    chat.messages.push(userMsg);
    saveChatsByUnit();

    messageInput.value = '';
    clearSelectedAttachment();
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

      const activeUnit = session?.selectedUnit || 'General Studies';
      const usage = getUserUsage();

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          unit: activeUnit,
          selectedUnit: activeUnit,
          imageBase64: attachmentToSend ? attachmentToSend.base64 : null,
          mimeType: attachmentToSend ? attachmentToSend.mimeType : null,
          email: session?.email || '',
          questionsUsed: usage.questionsUsed || 0,
          passExpiresAt: usage.passExpiresAt || 0,
          messages: apiMessages,
        }),
      });

      const data = await response.json().catch(() => ({}));
      removeTypingIndicator();

      if (response.status === 402 || data.code === 'PAYMENT_REQUIRED') {
        applyServerUsage(
          session?.email,
          data.questionsUsed ?? FREE_QUESTION_LIMIT,
          data.passExpiresAt ?? 0
        );
        // Remove the unsent user message from the chat view and open payment pop-up
        chat.messages.pop();
        saveChatsByUnit();
        renderMessages();
        openPaymentModal({ text, attachment: attachmentToSend });
        return;
      }

      if (!response.ok || !data.reply) {
        const errText = data.error || 'Something went wrong while contacting Matrix AI. Please try again.';
        const errMsg = {
          role: 'assistant',
          content: errText,
          time: formatTime(),
          isError: true,
          feedback: null,
        };
        chat.messages.push(errMsg);
        saveChatsByUnit();
        appendMessageToDOM(errMsg, chat.messages.length - 1);
      } else {
        applyServerUsage(session?.email, data.questionsUsed, data.passExpiresAt);
        const aiMsg = {
          role: 'assistant',
          content: data.reply,
          time: formatTime(),
          feedback: null,
        };
        chat.messages.push(aiMsg);
        saveChatsByUnit();
        appendMessageToDOM(aiMsg, chat.messages.length - 1);
        speakAssistantReply(data.reply);
      }
    } catch {
      removeTypingIndicator();
      const networkErrMsg = {
        role: 'assistant',
        content: 'Network error: Could not reach the server. Please check your connection and try again.',
        time: formatTime(),
        isError: true,
        feedback: null,
      };
      chat.messages.push(networkErrMsg);
      saveChatsByUnit();
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
    const hasContent = messageInput.value.trim().length > 0 || Boolean(selectedAttachment);
    sendBtn.disabled = isGenerating || !hasContent;
  }

  function openMobileSidebar() {
    sidebar.classList.add('open');
    sidebarOverlay.classList.add('active');
  }

  function closeMobileSidebar() {
    sidebar.classList.remove('open');
    sidebarOverlay.classList.remove('active');
  }

  // --- Event Listeners ---
  studentPasswordInput.addEventListener('input', updatePasswordMeter);

  togglePasswordBtn.addEventListener('click', () => {
    const isPass = studentPasswordInput.type === 'password';
    studentPasswordInput.type = isPass ? 'text' : 'password';
    togglePasswordBtn.innerHTML = isPass
      ? '<i class="fa-regular fa-eye-slash"></i>'
      : '<i class="fa-regular fa-eye"></i>';
  });

  authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAuthError();

    const email = studentEmailInput.value.trim().toLowerCase();
    const password = studentPasswordInput.value;
    const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

    if (!emailValid) {
      showAuthError('Please enter a valid student email address.');
      studentEmailInput.focus();
      return;
    }

    const { isStrong } = evaluatePassword(password);
    if (!isStrong) {
      showAuthError(
        'Please create a strong password with at least 8 characters, including uppercase, lowercase, a number, and a special symbol.'
      );
      studentPasswordInput.focus();
      return;
    }

    const submitBtn = authForm.querySelector('button[type="submit"]');
    const origBtnHtml = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>Signing in...</span><i class="fa-solid fa-spinner fa-spin"></i>';

    try {
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'login',
          email,
          password,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.student) {
        showAuthError(data.error || 'Could not sign in. Please check your credentials and try again.');
        return;
      }

      session = {
        email: data.student.email,
        passwordSet: true,
        selectedUnit: data.student.selectedUnit || null,
      };
      applyServerUsage(
        data.student.email,
        data.student.questionsUsed,
        data.student.passExpiresAt
      );
      saveSession();
      syncViewState();
    } catch {
      showAuthError('Network error while connecting to student database. Please try again.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = origBtnHtml;
    }
  });

  unitsGrid.querySelectorAll('.unit-option-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const unitVal = btn.getAttribute('data-unit');
      if (unitVal === 'OTHER') {
        customUnitBox.classList.remove('hidden');
        customUnitInput.focus();
      } else if (unitVal) {
        selectUnitAndOpenChat(unitVal);
      }
    });
  });

  confirmCustomUnitBtn.addEventListener('click', () => {
    const customName = customUnitInput.value.trim();
    if (!customName) {
      customUnitInput.focus();
      return;
    }
    selectUnitAndOpenChat(customName);
  });

  customUnitInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      confirmCustomUnitBtn.click();
    }
  });

  switchUnitBtn.addEventListener('click', () => {
    if (isGenerating || !session) return;
    stopSpeaking();
    session.selectedUnit = null;
    saveSession();
    syncViewState();
  });

  signOutBtn.addEventListener('click', signOutUser);
  sidebarSignOutBtn.addEventListener('click', signOutUser);

  // Photo Attachment Controls
  photoAttachBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    photoPickerMenu.classList.toggle('hidden');
  });

  takePhotoOptionBtn.addEventListener('click', () => {
    photoPickerMenu.classList.add('hidden');
    cameraFileInput.click();
  });

  chooseGalleryOptionBtn.addEventListener('click', () => {
    photoPickerMenu.classList.add('hidden');
    galleryFileInput.click();
  });

  galleryFileInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) processSelectedImageFile(file);
  });

  cameraFileInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) processSelectedImageFile(file);
  });

  removeAttachmentBtn.addEventListener('click', clearSelectedAttachment);

  document.addEventListener('click', (e) => {
    if (!photoPickerMenu.classList.contains('hidden') && !photoPickerMenu.contains(e.target) && e.target !== photoAttachBtn) {
      photoPickerMenu.classList.add('hidden');
    }
  });

  // Microphone & Voice Reply Controls
  micVoiceBtn.addEventListener('click', toggleMicrophoneListening);

  stopVoiceBannerBtn.addEventListener('click', () => {
    if (isListening && recognition) {
      try {
        recognition.stop();
      } catch {
        // Ignore
      }
    }
    hideVoiceOrInputNotice();
  });

  voiceReplyToggleBtn.addEventListener('click', () => {
    voiceReplyEnabled = !voiceReplyEnabled;
    saveVoiceReplyPref(voiceReplyEnabled);
    updateVoiceReplyToggleUI();
    if (!voiceReplyEnabled) {
      stopSpeaking();
    }
  });

  // Payment Modal Controls
  closePaymentModalBtn.addEventListener('click', closePaymentModal);
  paymentModal.addEventListener('click', (e) => {
    if (e.target === paymentModal) closePaymentModal();
  });
  paymentForm.addEventListener('submit', initiateTenBobPayment);
  verifyPaymentBtn.addEventListener('click', verifyTenBobPayment);

  // Textarea & Send Controls
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
