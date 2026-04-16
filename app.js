/**
 * PRÉCIS — AI Document Summarizer
 * app.js
 *
 * Connects to Hugging Face Inference API.
 * Configure your token + model ID in the Settings (⚙) panel.
 */

// ── Config Defaults ───────────────────────────────────────────────
const DEFAULTS = {
  modelId: 'facebook/bart-large-cnn',   // Change to your model ID
  token:   '',
};

// Length presets: [min_length, max_length]
const LENGTH_MAP = {
  short:  [30,  80],
  medium: [60,  150],
  long:   [100, 280],
};

// ── State ─────────────────────────────────────────────────────────
let cfg = {
  token:   localStorage.getItem('hf_token')   || DEFAULTS.token,
  modelId: localStorage.getItem('hf_model_id') || DEFAULTS.modelId,
};
let selectedLength = 'short';
let lastInput      = '';
let isLoading      = false;
let history        = JSON.parse(localStorage.getItem('précis_history') || '[]');

// ── DOM Refs ──────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const inputText    = $('inputText');
const wordCount    = $('wordCount');
const charCount    = $('charCount');
const summarizeBtn = $('summarizeBtn');
const copyBtn      = $('copyBtn');
const downloadBtn  = $('downloadBtn');
const clearBtn     = $('clearBtn');
const pasteBtn     = $('pasteBtn');
const retryBtn     = $('retryBtn');

const idleState    = $('idleState');
const loadingState = $('loadingState');
const resultState  = $('resultState');
const errorState   = $('errorState');
const resultText   = $('resultText');
const resultStats  = $('resultStats');
const compressionRatio = $('compressionRatio');

const statusDot    = $('statusDot');
const statusText   = $('statusText');
const toast        = $('toast');

const settingsBtn  = $('settingsBtn');
const modalOverlay = $('modalOverlay');
const modalClose   = $('modalClose');
const saveSettings = $('saveSettings');
const hfToken      = $('hfToken');
const modelId      = $('modelId');

const historySection  = $('historySection');
const historyList     = $('historyList');
const clearHistoryBtn = $('clearHistoryBtn');

const step1 = $('step1');
const step2 = $('step2');
const step3 = $('step3');

// ── Init ──────────────────────────────────────────────────────────
function init() {
  hfToken.value  = cfg.token;
  modelId.value  = cfg.modelId;
  setStatus('ready', 'Ready');
  renderHistory();
  bindEvents();
}

// ── Event Bindings ────────────────────────────────────────────────
function bindEvents() {
  inputText.addEventListener('input', onInputChange);
  summarizeBtn.addEventListener('click', summarize);
  clearBtn.addEventListener('click', clearInput);
  copyBtn.addEventListener('click', copyResult);
  downloadBtn.addEventListener('click', downloadResult);
  pasteBtn.addEventListener('click', pasteFromClipboard);
  retryBtn.addEventListener('click', () => { lastInput && summarize(); });
  clearHistoryBtn.addEventListener('click', clearHistory);

  // Length toggles
  document.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedLength = btn.dataset.length;
    });
  });

  // Settings modal
  settingsBtn.addEventListener('click', () => modalOverlay.classList.add('open'));
  modalClose.addEventListener('click', closeModal);
  modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });
  saveSettings.addEventListener('click', saveCfg);

  // Keyboard shortcut: Ctrl/Cmd + Enter to summarize
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') summarize();
  });
}

// ── Input Handling ────────────────────────────────────────────────
function onInputChange() {
  const text  = inputText.value;
  const words = countWords(text);
  const chars = text.length;

  wordCount.textContent = `${words.toLocaleString()} word${words !== 1 ? 's' : ''}`;
  charCount.textContent = `${chars.toLocaleString()} character${chars !== 1 ? 's' : ''}`;

  // Colour hints
  wordCount.style.color = words >= 50 ? 'var(--teal)' : words > 0 ? 'var(--gold)' : 'var(--teal)';
}

function countWords(text) {
  return text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
}

function clearInput() {
  inputText.value = '';
  onInputChange();
  showState('idle');
  copyBtn.disabled = true;
  downloadBtn.disabled = true;
  setStatus('ready', 'Ready');
}

async function pasteFromClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    inputText.value = text;
    onInputChange();
    showToast('Text pasted from clipboard');
  } catch {
    showToast('Could not read clipboard — paste manually');
  }
}

// ── Core: Summarize ───────────────────────────────────────────────
async function summarize() {
  const text = inputText.value.trim();

  if (!text) {
    showToast('Please enter some text first');
    inputText.focus();
    return;
  }
  if (countWords(text) < 10) {
    showToast('Text is too short — add more content');
    return;
  }
  lastInput = text;
  isLoading = true;
  summarizeBtn.disabled = true;
  copyBtn.disabled = true;
  downloadBtn.disabled = true;
  setStatus('loading', 'Processing…');
  showState('loading');
  animateLoadingSteps();

  const [minLen, maxLen] = LENGTH_MAP[selectedLength];

  try {
    const summary = await callHuggingFace(text, minLen, maxLen);
    displayResult(text, summary);
    addToHistory(text, summary);
  } catch (err) {
    showError(err);
  } finally {
    isLoading = false;
    summarizeBtn.disabled = false;
  }
}

async function callHuggingFace(text, minLength, maxLength) {

  const payload = {
    dialogue: text,
    min_length: minLength,
    max_length: maxLength,
  };

  let res;

  try {
    res = await fetch("/summarize/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (networkErr) {
    throw new Error('Network error — check your backend server.');
  }

  if (!res.ok) {
    let msg = `Server error ${res.status}`;
    try {
      const body = await res.json();
      if (body.error) msg = body.error;
      if (body.detail) msg = body.detail;
    } catch {}

    throw new Error(msg);
  }

  const data = await res.json();

  if (data.summary) return data.summary;
  if (data.generated_text) return data.generated_text;
  if (typeof data === 'string') return data;

  throw new Error('Unexpected response format from backend.');
}

// ── Display Result ────────────────────────────────────────────────
function displayResult(originalText, summary) {
  const origWords = countWords(originalText);
  const sumWords  = countWords(summary);
  const ratio     = Math.round((1 - sumWords / origWords) * 100);
  const timeSaved = Math.round(origWords / 200);   // avg 200 wpm reading speed

  resultText.textContent = summary;
  compressionRatio.textContent = `${ratio > 0 ? ratio + '% shorter' : 'Expanded'}`;

  resultStats.innerHTML = `
    <div class="stat"><span class="stat-val">${sumWords}</span><span class="stat-key">Words</span></div>
    <div class="stat"><span class="stat-val">${origWords.toLocaleString()}</span><span class="stat-key">Original</span></div>
    <div class="stat"><span class="stat-val">${timeSaved < 1 ? '<1' : timeSaved} min</span><span class="stat-key">Saved</span></div>
    <div class="stat"><span class="stat-val">${ratio > 0 ? ratio + '%' : '—'}</span><span class="stat-key">Compression</span></div>
  `;

  showState('result');
  setStatus('ready', 'Done');
  copyBtn.disabled = false;
  downloadBtn.disabled = false;
}

function showError(err) {
  $('errorTitle').textContent = 'Summarization Failed';
  $('errorMsg').textContent   = err.message || String(err);
  showState('error');
  setStatus('error', 'Error');
}

// ── Loading Animation ─────────────────────────────────────────────
function animateLoadingSteps() {
  const steps = [step1, step2, step3];
  steps.forEach(s => { s.classList.remove('active', 'done'); });
  step1.classList.add('active');

  setTimeout(() => {
    if (!isLoading) return;
    step1.classList.remove('active'); step1.classList.add('done');
    step2.classList.add('active');
  }, 1200);

  setTimeout(() => {
    if (!isLoading) return;
    step2.classList.remove('active'); step2.classList.add('done');
    step3.classList.add('active');
  }, 2800);
}

// ── State Management ──────────────────────────────────────────────
function showState(name) {
  idleState.classList.add('hidden');
  loadingState.classList.add('hidden');
  resultState.classList.add('hidden');
  errorState.classList.add('hidden');

  switch (name) {
    case 'idle':    idleState.classList.remove('hidden');    break;
    case 'loading': loadingState.classList.remove('hidden'); break;
    case 'result':  resultState.classList.remove('hidden');  break;
    case 'error':   errorState.classList.remove('hidden');   break;
  }
}

function setStatus(type, text) {
  statusDot.className  = `status-dot ${type}`;
  statusText.textContent = text;
}

// ── Copy & Download ───────────────────────────────────────────────
async function copyResult() {
  const text = resultText.textContent;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    showToast('Summary copied to clipboard ✓');
  } catch {
    showToast('Copy failed — try selecting and copying manually');
  }
}

function downloadResult() {
  const summary = resultText.textContent;
  if (!summary) return;

  const timestamp = new Date().toLocaleString();
  const original  = lastInput;
  const content   = `PRÉCIS — AI Summary\nGenerated: ${timestamp}\nModel: ${cfg.modelId}\n${'─'.repeat(60)}\n\nORIGINAL TEXT\n${'─'.repeat(60)}\n${original}\n\n${'─'.repeat(60)}\n\nSUMMARY\n${'─'.repeat(60)}\n${summary}`;

  const blob = new Blob([content], { type: 'text/plain' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `précis-summary-${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Summary exported');
}

// ── History ───────────────────────────────────────────────────────
function addToHistory(original, summary) {
  const entry = {
    id:        Date.now(),
    timestamp: new Date().toLocaleString(),
    original,
    summary,
    words:     countWords(summary),
  };
  history.unshift(entry);
  if (history.length > 20) history.pop();   // keep last 20
  localStorage.setItem('précis_history', JSON.stringify(history));
  renderHistory();
}

function renderHistory() {
  if (!history.length) {
    historySection.classList.add('empty');
    return;
  }
  historySection.classList.remove('empty');
  historyList.innerHTML = '';

  history.slice(0, 6).forEach(entry => {
    const card = document.createElement('div');
    card.className = 'history-card';
    card.innerHTML = `
      <div class="history-card-time">${entry.timestamp}</div>
      <div class="history-card-preview">${entry.summary}</div>
    `;
    card.addEventListener('click', () => {
      inputText.value = entry.original;
      onInputChange();
      displayResult(entry.original, entry.summary);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    historyList.appendChild(card);
  });
}

function clearHistory() {
  history = [];
  localStorage.removeItem('précis_history');
  historySection.classList.add('empty');
  showToast('History cleared');
}

// ── Settings Modal ────────────────────────────────────────────────
function closeModal() {
  modalOverlay.classList.remove('open');
}

function saveCfg() {
  const token = hfToken.value.trim();
  const model = modelId.value.trim();

  if (!token) { showToast('Please enter your API token'); return; }
  if (!model) { showToast('Please enter a Model ID'); return; }

  cfg.token   = token;
  cfg.modelId = model;
  localStorage.setItem('hf_token',    token);
  localStorage.setItem('hf_model_id', model);

  closeModal();
  showToast('Configuration saved ✓');
  setStatus('ready', 'Ready');
}

// ── Toast ─────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg) {
  clearTimeout(toastTimer);
  toast.textContent = msg;
  toast.classList.add('show');
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
}

// ── Boot ──────────────────────────────────────────────────────────
init();
