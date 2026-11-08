'use strict';

/* ============================================================
   DevOps Trainer — вся логика приложения.
   Без фреймворков и сборки: загрузка карточек из data/cards.json,
   прогресс и добавленные карточки — в localStorage.
   ============================================================ */

const CARDS_URL = 'data/cards.json';

const STORAGE = {
  progress: 'trainer.progress.v1',
  custom: 'trainer.custom.v1',
  theme: 'trainer.theme.v1',
  learning: 'trainer.learning.v1',
  mode: 'trainer.mode.v1',
  training: 'trainer.training.v1',
  discussion: 'trainer.discussion.v1',
  reviews: 'trainer.reviews.v1',
  dismissed: 'trainer.errors-dismissed.v1',
};

const DIFFICULTIES = ['easy', 'medium', 'hard'];
const SESSION_SIZES = [10, 20, 30, 40, 50, 100, 'all'];

/* ---------- состояние ---------- */

const app = {
  baseCards: [],
  customCards: [],
  cards: [],
  progress: {},
  learning: {},
  training: {},
  reviews: {},
  dismissed: {},
  session: null,
  answered: false,
  attemptRecorded: false,
  includeReview: false,
  studyMode: 'quiz',
  learnSize: 20,
  reviewSize: 20,
  discussion: {},
  discussionFormCardId: null,
  discussionViewId: null,
  pendingUpdate: null,
  summaryPrimary: null,
  summarySecondary: null,
};

/* ---------- DOM ---------- */

const dom = {};

function cacheDom() {
  const ids = [
    'alertBox', 'menuSummary', 'sectionsList', 'menuEmpty',
    'reviewSummary', 'dueHint', 'btnDue', 'btnNew', 'btnErrors', 'btnDismissErrors', 'btnStats',
    'learnSizes', 'reviewSizes', 'btnMixed', 'btnMixedEndless',
    'btnDiscuss', 'btnDiscussion', 'discussionSummary', 'discussionList', 'discussionEmpty',
    'btnDiscussionCopy', 'btnDiscussionDownload', 'btnDiscussionBack',
    'discussionCopyBox', 'discussionCopyFallback',
    'discussionModal', 'discussionModalQuestion', 'discussionComment',
    'btnDiscussionSave', 'btnDiscussionRemove', 'btnDiscussionCancel',
    'screen-discussion', 'screen-discussion-view',
    'discussionViewTitle', 'discussionViewMeta', 'discussionViewSection',
    'discussionViewQuestion', 'discussionViewOptions', 'discussionViewAnswer',
    'discussionViewExplain', 'discussionViewComment', 'discussionViewWarning',
    'btnDiscussionEditFromView', 'btnDiscussionRemoveFromView', 'btnDiscussionViewBack',
    'btnDiscussionRefresh', 'updateBanner', 'btnUpdateNow', 'btnUpdateLater', 'offlineStatus',
    'modeQuiz', 'modeRecall', 'toggleReview', 'toggleReviewLabel',
    'btnAddCard', 'btnImport', 'btnExport', 'btnBackup', 'btnRestore', 'importInput', 'backupInput',
    'quizCounter', 'quizProgress', 'quizProgressBar', 'quizMode', 'cardSection', 'cardQuestion',
    'reviewBanner', 'recallBox', 'recallInput', 'btnHint', 'btnReveal',
    'optionsList', 'revealBox', 'revealAnswer', 'revealExplain', 'revealVerdict',
    'btnAssessFailed', 'btnAssessIndependent',
    'feedbackBox', 'feedbackVerdict', 'feedbackExplain', 'feedbackMeta',
    'btnNext', 'btnFinish', 'btnQuizToMenu', 'btnBackToMenu',
    'summaryTitle', 'summarySubtitle', 'summaryStats',
    'btnSummaryPrimary', 'btnSummarySecondary', 'btnSummaryMenu',
    'statsTotals', 'statsTable', 'btnStatsBack',
    'btnTheme', 'brandLink', 'addForm', 'sectionOptions', 'btnCancelAdd',
    'fieldSection', 'fieldTopic', 'fieldDifficulty', 'fieldTags', 'fieldQuestion',
    'fieldCorrect', 'fieldExplanation', 'fieldSource',
    'screen-menu', 'screen-quiz', 'screen-summary', 'screen-stats', 'screen-add',
  ];
  ids.forEach((id) => {
    dom[id] = document.getElementById(id);
  });
  dom.optionInputs = Array.from(document.querySelectorAll('.option-input'));
}

/* ---------- утилиты ---------- */

function uid(prefix) {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `${prefix}-${stamp}${rand}`;
}

function shuffle(items) {
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch (err) {
    console.warn('Не удалось прочитать', key, err);
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    notify('Не удалось сохранить данные в браузере: ' + err.message, 'error');
    return false;
  }
}

function progressEntry(id) {
  return app.progress[id] || { seen: 0, correct: 0, wrong: 0, lastWrongAt: null };
}

function cardsWithErrors(cards) {
  return cards.filter((card) => progressEntry(card.id).wrong > 0);
}

/* Карточки с needs_review по умолчанию в сессии не попадают:
   их включает переключатель «Включить карточки на проверке». */

function isAvailable(card) {
  return app.includeReview || !card.needs_review;
}

function availableCards(cards) {
  return cards.filter(isAvailable);
}

function reviewCards(cards) {
  return cards.filter((card) => card.needs_review);
}

/* ---------- учебное расписание ----------
   Отдельно от истории correct/wrong: прогресс отвечает на вопрос
   «что было», расписание — «что показать сегодня».
   Интервалы 3/7/14/30 — простая настройка первой версии. */

const LEARNING_LADDER = [3, 7, 14, 30];
const LEARNING_RESULTS = ['failed', 'hinted', 'independent', 'learned'];
const LEARNING_LADDER_LAST = LEARNING_LADDER[LEARNING_LADDER.length - 1];

function startOfLocalDay(date) {
  const copy = new Date(date.getTime());
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addLocalDays(date, days) {
  const copy = startOfLocalDay(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function localDayKey(date) {
  const day = startOfLocalDay(date);
  const month = String(day.getMonth() + 1).padStart(2, '0');
  const datePart = String(day.getDate()).padStart(2, '0');
  return `${day.getFullYear()}-${month}-${datePart}`;
}

function nextInterval(current) {
  for (const step of LEARNING_LADDER) {
    if (step > current) return step;
  }
  return LEARNING_LADDER_LAST;
}

function learningEntry(cardId) {
  return app.learning[cardId] || null;
}

function isDueNow(card, now) {
  const entry = learningEntry(card.id);
  if (!entry) return false;
  return new Date(entry.dueAt).getTime() <= now.getTime();
}

function dueCards(cards, now) {
  const moment = now || new Date();
  return cards.filter((card) => isDueNow(card, moment));
}

function newCards(cards) {
  return cards.filter((card) => !learningEntry(card.id));
}

/* Возвращает true, если запись в localStorage удалась. */
function updateLearning(cardId, result) {
  const now = new Date();
  const previous = learningEntry(cardId);
  const sameDay = Boolean(previous && previous.lastReviewedAt)
    && localDayKey(new Date(previous.lastReviewedAt)) === localDayKey(now);

  // Повторный УСПЕХ в тот же день расписание не двигает: второй проход не
  // должен ни сдвигать dueAt дальше, ни отменять назначенное «завтра» после
  // ошибки, ни возвращать длинный интервал. Ошибка и подсказка при этом
  // всегда назначают следующий день — в том числе при повторе сегодня.
  if (result === 'independent' && sameDay && previous) {
    previous.lastReviewedAt = now.toISOString();
    previous.independentSuccesses += 1;
    app.learning[cardId] = previous;
    return saveLearning();
  }

  let intervalDays = previous ? previous.intervalDays : 0;
  let independentSuccesses = previous ? previous.independentSuccesses : 0;
  let dueAt;

  if (result === 'independent') {
    intervalDays = nextInterval(intervalDays);
    independentSuccesses += 1;
    dueAt = addLocalDays(now, intervalDays);
  } else {
    intervalDays = 0;
    dueAt = addLocalDays(now, 1);
  }

  app.learning[cardId] = {
    lastReviewedAt: now.toISOString(),
    dueAt: dueAt.toISOString(),
    intervalDays,
    lastResult: result,
    independentSuccesses,
  };

  return saveLearning();
}

/* ---------- слои статистики ----------
   training — усилия в режиме «Учить»;
   reviews  — итоги запланированных повторений;
   progress — унаследованная общая история, только читается.
   Не смешиваем: события до разделения режимов не различались. */

function trainingEntry(cardId) {
  return app.training[cardId] || {
    attempts: 0, correct: 0, wrong: 0, hinted: 0, independent: 0, lastAt: null,
  };
}

function reviewsEntry(cardId) {
  return app.reviews[cardId] || {
    attempts: 0, independent: 0, hinted: 0, failed: 0, lastAt: null,
  };
}

function updateTraining(cardId, mode, isCorrect) {
  const entry = trainingEntry(cardId);
  entry.attempts += 1;
  if (isCorrect) {
    entry.correct += 1;
    if (mode === 'independent') entry.independent += 1;
    else entry.hinted += 1;
  } else {
    entry.wrong += 1;
  }
  entry.lastAt = new Date().toISOString();
  app.training[cardId] = entry;
  return saveTraining();
}

function updateReviews(cardId, mode, isCorrect) {
  const entry = reviewsEntry(cardId);
  entry.attempts += 1;
  if (isCorrect && mode === 'independent') entry.independent += 1;
  else if (isCorrect) entry.hinted += 1;
  else entry.failed += 1;
  entry.lastAt = new Date().toISOString();
  app.reviews[cardId] = entry;
  return saveReviews();
}

/* Ошибки — исторический список: успех карточку не убирает.
   Источники: тренировка, повторения и старая история, объединение по id. */
function hasHistoryError(cardId) {
  return trainingEntry(cardId).wrong > 0
    || reviewsEntry(cardId).failed > 0
    || progressEntry(cardId).wrong > 0;
}

function errorCards(cards) {
  return cards.filter((card) => !app.dismissed[card.id] && hasHistoryError(card.id));
}

function scheduledCards(cards) {
  return cards.filter((card) => Boolean(learningEntry(card.id)));
}

/* Первая запись в расписании появляется только после завершённой попытки
   в режиме «Учить». lastReviewedAt = null: настоящего повторения ещё не было. */
function ensureLearningEntry(card) {
  if (learningEntry(card.id)) return true;
  app.learning[card.id] = {
    lastReviewedAt: null,
    dueAt: addLocalDays(new Date(), 1).toISOString(),
    intervalDays: 0,
    lastResult: 'learned',
    independentSuccesses: 0,
  };
  return saveLearning();
}

function groupBySection(cards) {
  const map = new Map();
  cards.forEach((card) => {
    const name = card.section || 'Без раздела';
    if (!map.has(name)) map.set(name, []);
    map.get(name).push(card);
  });
  return map;
}

/* ---------- нормализация карточки ---------- */

function normalizeCard(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const question = String(raw.question || '').trim();
  const options = Array.isArray(raw.options)
    ? raw.options.map((opt) => String(opt).trim()).filter(Boolean)
    : [];
  const explanation = String(raw.explanation || '').trim();

  if (!question || options.length < 2 || !explanation) return null;

  const correctIndex = Number(raw.correct_index);
  if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) {
    return null;
  }

  const card = {
    id: String(raw.id || '').trim() || uid('card'),
    section: String(raw.section || '').trim() || 'Без раздела',
    topic: String(raw.topic || '').trim() || 'Без темы',
    difficulty: DIFFICULTIES.includes(raw.difficulty) ? raw.difficulty : 'medium',
    question,
    options,
    correct_index: correctIndex,
    explanation,
    source_note: String(raw.source_note || '').trim() || 'добавлено вручную',
    tags: Array.isArray(raw.tags)
      ? raw.tags.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean)
      : [],
    needs_review: Boolean(raw.needs_review),
  };

  if (card.needs_review) {
    card.question_to_check = String(raw.question_to_check || '').trim();
  }

  // Необязательные метаданные сохраняем как есть, чтобы они не терялись
  // при импорте, экспорте и резервном копировании.
  if (typeof raw.provenance === 'string' && raw.provenance.trim()) {
    card.provenance = raw.provenance.trim();
  }
  ['derived_from', 'related_cards', 'sources'].forEach((field) => {
    if (!Array.isArray(raw[field])) return;
    const values = raw[field].map((item) => String(item).trim()).filter(Boolean);
    if (values.length) card[field] = values;
  });
  if (typeof raw.verified === 'boolean') {
    card.verified = raw.verified;
  }

  return card;
}

/* ---------- загрузка данных ---------- */

async function loadBaseCards() {
  try {
    // Свежесть базы обеспечивает service worker; обычный fetch нужен,
    // чтобы карточки открывались и без активного SW (например, при первом офлайне).
    const response = await fetch(CARDS_URL);
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error('ожидался массив карточек');

    app.baseCards = data.map(normalizeCard).filter(Boolean);

    const dropped = data.length - app.baseCards.length;
    if (dropped > 0) {
      console.warn(`Пропущено некорректных карточек: ${dropped}`);
    }
  } catch (err) {
    app.baseCards = [];
    if (navigator.onLine === false) {
      notify(
        'Нет соединения и нет сохранённой копии приложения. Подключитесь к интернету и обновите ' +
        'страницу — сервер отдаст карточки, и после этого приложение сохранит их для работы офлайн.',
        'error',
      );
      return;
    }
    notify(
      'Не удалось загрузить data/cards.json (' + err.message + '). ' +
      'Запустите start.ps1 или `python -m http.server` и откройте http://127.0.0.1:8000/ — ' +
      'при открытии файла напрямую браузер блокирует чтение JSON.',
      'error',
    );
  }
}

function loadCustomCards() {
  const raw = readJson(STORAGE.custom, []);
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeCard).filter(Boolean);
}

function loadProgress() {
  const raw = readJson(STORAGE.progress, {});
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return raw;
}

function loadLearning() {
  const raw = readJson(STORAGE.learning, {});
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return raw;
}

function saveProgress() {
  return writeJson(STORAGE.progress, app.progress);
}

function saveCustomCards() {
  return writeJson(STORAGE.custom, app.customCards);
}

function saveLearning() {
  return writeJson(STORAGE.learning, app.learning);
}

function loadTraining() {
  const raw = readJson(STORAGE.training, {});
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return raw;
}

function saveTraining() {
  return writeJson(STORAGE.training, app.training);
}

function loadReviews() {
  const raw = readJson(STORAGE.reviews, {});
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return raw;
}

function saveReviews() {
  return writeJson(STORAGE.reviews, app.reviews);
}

function loadDismissed() {
  const raw = readJson(STORAGE.dismissed, {});
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return raw;
}

function saveDismissed() {
  return writeJson(STORAGE.dismissed, app.dismissed);
}

function loadDiscussion() {
  const raw = readJson(STORAGE.discussion, {});
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return raw;
}

function saveDiscussion() {
  return writeJson(STORAGE.discussion, app.discussion);
}

function rebuildCards() {
  const seen = new Set();
  const merged = [];
  [...app.baseCards, ...app.customCards].forEach((card) => {
    if (seen.has(card.id)) return;
    seen.add(card.id);
    merged.push(card);
  });
  app.cards = merged;
}

/* ---------- тема ---------- */

function applyTheme(theme) {
  const value = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = value;
  dom.btnTheme.textContent = value === 'dark' ? 'Тема: тёмная' : 'Тема: светлая';
  dom.btnTheme.setAttribute('aria-pressed', String(value === 'dark'));
}

function toggleTheme() {
  const current = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try {
    localStorage.setItem(STORAGE.theme, next);
  } catch (err) {
    console.warn('Тема не сохранилась', err);
  }
}

function loadMode() {
  const raw = readJson(STORAGE.mode, null);
  return raw === 'recall' ? 'recall' : 'quiz';
}

function saveMode() {
  return writeJson(STORAGE.mode, app.studyMode);
}

function initTheme() {
  let saved = null;
  try {
    saved = localStorage.getItem(STORAGE.theme);
  } catch (err) {
    console.warn('localStorage недоступен', err);
  }
  applyTheme(saved === 'light' ? 'light' : 'dark');
}

/* ---------- экраны и уведомления ---------- */

function showScreen(name) {
  ['menu', 'quiz', 'summary', 'stats', 'add', 'discussion', 'discussion-view'].forEach((screenName) => {
    dom[`screen-${screenName}`].hidden = screenName !== name;
  });
  hideNotice();
}

function notify(message, kind = 'info') {
  dom.alertBox.textContent = message;
  dom.alertBox.className = 'alert alert--' + kind;
  dom.alertBox.hidden = false;
}

function hideNotice() {
  dom.alertBox.hidden = true;
  dom.alertBox.textContent = '';
}

/* ---------- «На разбор» ----------
   Личные отметки. Отдельный ключ, отдельно от истории и расписания:
   добавление отметки не считается учебной попыткой. */

const DISCUSSION_COMMENT_LIMIT = 2000;

function makeSnapshot(card) {
  const snapshot = {
    question: card.question,
    options: card.options.slice(),
    correct_index: card.correct_index,
    explanation: card.explanation,
    section: card.section,
    topic: card.topic,
  };
  if (Array.isArray(card.sources) && card.sources.length) {
    snapshot.sources = card.sources.slice();
  }
  return snapshot;
}

function discussionEntry(cardId) {
  return app.discussion[cardId] || null;
}

function snapshotDiffers(entry, card) {
  if (!entry || !card) return true;
  const s = entry.snapshot;
  return s.question !== card.question
    || s.explanation !== card.explanation
    || s.correct_index !== card.correct_index
    || s.section !== card.section
    || s.topic !== card.topic
    || JSON.stringify(s.options) !== JSON.stringify(card.options);
}

function saveDiscussionFromForm() {
  const cardId = app.discussionFormCardId;
  if (!cardId) return;

  const card = app.cards.find((item) => item.id === cardId);
  const existing = discussionEntry(cardId);
  const comment = dom.discussionComment.value.trim().slice(0, DISCUSSION_COMMENT_LIMIT);

  if (!existing && !card) {
    notify('Карточки нет в актуальной базе — сохранить снимок не из чего.', 'error');
    return;
  }

  const now = new Date().toISOString();
  app.discussion[cardId] = {
    cardId,
    comment,
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now,
    snapshot: existing ? existing.snapshot : makeSnapshot(card),
  };

  if (!saveDiscussion()) {
    if (existing) app.discussion[cardId] = existing;
    else delete app.discussion[cardId];
    notify('Не удалось сохранить отметку в браузере.', 'error');
    return;
  }

  closeDiscussionForm();
  updateDiscussButton(cardId);
  if (app.discussionViewId === cardId) openDiscussionView(cardId);
  renderMenu();
  notify(existing ? 'Комментарий обновлён.' : 'Карточка добавлена на разбор.', 'success');
}

function removeDiscussionById(cardId, options) {
  const existing = discussionEntry(cardId);
  if (!existing) return;

  if (!options || !options.silent) {
    const ok = window.confirm('Убрать карточку из списка «На разбор»? Комментарий будет удалён.');
    if (!ok) return;
  }

  delete app.discussion[cardId];
  if (!saveDiscussion()) {
    app.discussion[cardId] = existing;
    notify('Не удалось сохранить изменение в браузере.', 'error');
    return;
  }

  updateDiscussButton(cardId);
  renderDiscussion();
  renderMenu();
  notify('Карточка убрана с разбора.', 'success');
}

function updateDiscussButton(cardId) {
  if (!dom.btnDiscuss) return;
  const marked = Boolean(discussionEntry(cardId));
  dom.btnDiscuss.textContent = marked ? 'На разборе' : 'На разбор';
  dom.btnDiscuss.classList.toggle('btn--primary', marked);
}

function openDiscussionForm(cardId) {
  const card = app.cards.find((item) => item.id === cardId);
  const entry = discussionEntry(cardId);
  if (!card && !entry) return;

  app.discussionFormCardId = cardId;
  dom.discussionModalQuestion.textContent = card ? card.question : (entry.snapshot.question || '');
  dom.discussionComment.value = entry ? entry.comment : '';
  dom.btnDiscussionRemove.hidden = !entry;
  dom.discussionModal.hidden = false;

  // не даём клавиатуре утащить страницу
  try {
    dom.discussionComment.focus({ preventScroll: true });
  } catch (err) {
    dom.discussionComment.focus();
  }
}

function closeDiscussionForm() {
  dom.discussionModal.hidden = true;
  app.discussionFormCardId = null;
  dom.discussionComment.value = '';
}

function discussionEntries() {
  return Object.values(app.discussion)
    .filter((entry) => entry && entry.cardId)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function renderDiscussion() {
  const entries = discussionEntries();
  dom.discussionSummary.textContent = entries.length
    ? `Отмечено карточек: ${entries.length}`
    : 'Список пуст';

  dom.btnDiscussionCopy.disabled = entries.length === 0;
  dom.btnDiscussionDownload.disabled = entries.length === 0;

  dom.discussionList.textContent = '';
  dom.discussionEmpty.hidden = entries.length > 0;

  entries.forEach((entry) => {
    const card = app.cards.find((item) => item.id === entry.cardId);
    const snapshot = entry.snapshot || {};

    const item = document.createElement('li');
    item.className = 'discussion-item';

    const section = document.createElement('p');
    section.className = 'discussion-item__section';
    section.textContent = [snapshot.section, snapshot.topic].filter(Boolean).join(' · ') || 'Без раздела';

    const question = document.createElement('p');
    question.className = 'discussion-item__question';
    question.textContent = snapshot.question || 'Снимок карточки отсутствует';

    const comment = document.createElement('p');
    comment.className = 'discussion-item__comment' + (entry.comment ? '' : ' discussion-item__comment--empty');
    comment.textContent = entry.comment || 'Без комментария';

    item.append(section, question, comment);

    if (!card) {
      const warning = document.createElement('p');
      warning.className = 'discussion-item__warning';
      warning.textContent = 'Карточки больше нет в актуальной базе — показан сохранённый снимок.';
      item.appendChild(warning);
    }

    const actions = document.createElement('div');
    actions.className = 'discussion-item__actions';

    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'btn btn--primary';
    openBtn.textContent = 'Открыть';
    openBtn.dataset.action = 'open';
    openBtn.dataset.card = entry.cardId;

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn';
    editBtn.textContent = 'Изменить комментарий';
    editBtn.dataset.action = 'edit';
    editBtn.dataset.card = entry.cardId;

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn btn--danger';
    removeBtn.textContent = 'Убрать';
    removeBtn.dataset.action = 'remove';
    removeBtn.dataset.card = entry.cardId;

    actions.append(openBtn, editBtn, removeBtn);
    item.appendChild(actions);
    dom.discussionList.appendChild(item);
  });
}

function openDiscussionView(cardId) {
  const entry = discussionEntry(cardId);
  if (!entry) {
    renderDiscussion();
    showScreen('discussion');
    return;
  }

  const card = app.cards.find((item) => item.id === cardId);
  const snapshot = entry.snapshot;
  app.discussionViewId = cardId;

  dom.discussionViewTitle.textContent = 'Карточка на разборе';
  dom.discussionViewMeta.textContent = [snapshot.section, snapshot.topic].filter(Boolean).join(' · ');
  dom.discussionViewSection.textContent = snapshot.section || '';
  dom.discussionViewQuestion.textContent = snapshot.question;

  dom.discussionViewOptions.textContent = '';
  snapshot.options.forEach((text, index) => {
    const li = document.createElement('li');
    const row = document.createElement('div');
    row.className = 'option' + (index === snapshot.correct_index ? ' is-correct' : '');

    const key = document.createElement('span');
    key.className = 'option__key';
    key.textContent = String(index + 1);

    const label = document.createElement('span');
    label.className = 'option__text';
    label.textContent = text;

    row.append(key, label);
    li.appendChild(row);
    dom.discussionViewOptions.appendChild(li);
  });

  dom.discussionViewAnswer.textContent = `Правильный ответ: ${snapshot.options[snapshot.correct_index]}`;
  dom.discussionViewExplain.textContent = snapshot.explanation;
  dom.discussionViewComment.textContent = 'Мой комментарий: ' + (entry.comment || '—');

  const missing = !card;
  const changed = !missing && snapshotDiffers(entry, card);
  dom.discussionViewWarning.hidden = !(missing || changed);
  if (missing) {
    dom.discussionViewWarning.textContent = 'Карточки больше нет в актуальной базе — показан сохранённый снимок.';
  } else if (changed) {
    dom.discussionViewWarning.textContent = 'Карточка в базе изменилась — показан сохранённый снимок. Можно обновить его вручную.';
  }
  dom.btnDiscussionRefresh.hidden = !changed;

  showScreen('discussion-view');
  window.scrollTo({ top: 0 });
}

function refreshDiscussionSnapshot() {
  const cardId = app.discussionViewId;
  const card = app.cards.find((item) => item.id === cardId);
  const entry = discussionEntry(cardId);
  if (!card || !entry) return;

  const ok = window.confirm('Обновить сохранённый снимок карточки? Комментарий останется прежним.');
  if (!ok) return;

  entry.snapshot = makeSnapshot(card);
  entry.updatedAt = new Date().toISOString();
  if (!saveDiscussion()) {
    notify('Не удалось сохранить обновление снимка.', 'error');
    return;
  }
  openDiscussionView(cardId);
  renderDiscussion();
  notify('Снимок карточки обновлён.', 'success');
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function buildDiscussionMarkdown() {
  const entries = discussionEntries();
  const lines = [
    '# Разбор отмеченных карточек',
    '',
    'Помоги разобрать отмеченные вопросы.',
    'Для каждого сначала ответь на мой комментарий простым языком,',
    'затем приведи пример. Если проблема в самой карточке —',
    'отдельно предложи исправление.',
    'Не считай содержание карточки автоматически достоверным.',
    '',
  ];

  entries.forEach((entry, index) => {
    const s = entry.snapshot || {};
    lines.push(`## ${index + 1}. ${s.section || 'Без раздела'} — ${s.topic || 'Без темы'}`);
    lines.push('');
    lines.push(`- id: ${entry.cardId}`);
    lines.push(`- раздел: ${s.section || '—'}`);
    lines.push(`- тема: ${s.topic || '—'}`);
    lines.push(`- вопрос: ${s.question || '—'}`);
    lines.push('- варианты:');
    (s.options || []).forEach((option, i) => {
      lines.push(`  ${i + 1}. ${option}`);
    });
    const correctNumber = Number.isInteger(s.correct_index) ? s.correct_index + 1 : '—';
    const correctText = s.options && Number.isInteger(s.correct_index) ? s.options[s.correct_index] : '—';
    lines.push(`- правильный ответ: №${correctNumber} — ${correctText}`);
    lines.push(`- объяснение: ${s.explanation || '—'}`);
    lines.push(`- мой комментарий: ${entry.comment || '—'}`);
    if (Array.isArray(s.sources) && s.sources.length) {
      lines.push(`- источники: ${s.sources.join(', ')}`);
    }
    lines.push(`- снимок сохранён: ${formatDateTime(entry.createdAt)}`);
    lines.push('');
  });

  return lines.join('\n');
}

async function copyDiscussion() {
  const text = buildDiscussionMarkdown();
  dom.discussionCopyBox.hidden = true;

  try {
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      throw new Error('Clipboard API недоступен');
    }
    await navigator.clipboard.writeText(text);
    notify('Текст для разбора скопирован в буфер обмена.', 'success');
  } catch (err) {
    dom.discussionCopyFallback.value = text;
    dom.discussionCopyBox.hidden = false;
    dom.discussionCopyFallback.focus();
    dom.discussionCopyFallback.select();
    notify('Скопировать автоматически не удалось — текст ниже можно скопировать вручную.', 'error');
  }
}

function downloadDiscussion() {
  const text = buildDiscussionMarkdown();
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `razbor-${new Date().toISOString().slice(0, 10)}.md`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  notify('Файл для разбора сформирован. Отметки в списке сохранились.', 'success');
}

/* ---------- размер сессии ---------- */

function renderSizeSwitch(container, current, onPick) {
  if (!container) return;
  container.textContent = '';

  SESSION_SIZES.forEach((size) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'size-switch__btn';
    button.dataset.size = String(size);
    button.textContent = size === 'all' ? 'Все' : String(size);
    button.setAttribute('aria-pressed', String(current === size));
    button.addEventListener('click', () => onPick(size));
    container.appendChild(button);
  });
}

function pickSample(cards, size) {
  const pool = shuffle(cards);
  if (size === 'all') return pool;
  return pool.slice(0, Math.min(size, pool.length));
}

/* ---------- главный экран ---------- */

function renderMenu() {
  const sections = groupBySection(app.cards);
  const available = availableCards(app.cards);
  const review = reviewCards(app.cards);
  const now = new Date();
  const due = dueCards(available, now);
  const scheduled = scheduledCards(available);
  const fresh = newCards(available);
  const errors = errorCards(available);

  dom.menuSummary.textContent =
    `Доступно карточек: ${available.length} из ${app.cards.length} · разделов: ${sections.size} · ` +
    `в расписании: ${scheduled.length} · на проверке: ${review.length}`;

  const reviewTake = app.reviewSize === 'all'
    ? due.length
    : Math.min(app.reviewSize, due.length);
  const learnTake = app.learnSize === 'all'
    ? available.length
    : Math.min(app.learnSize, available.length);

  dom.reviewSummary.textContent = `На сегодня: ${due.length}`;
  dom.btnDue.textContent = `Повторять — ${reviewTake}`;
  dom.btnDue.disabled = reviewTake === 0;

  dom.btnMixed.textContent = `Начать — ${learnTake}`;
  dom.btnMixed.disabled = learnTake === 0;
  dom.btnMixedEndless.disabled = available.length === 0;

  renderSizeSwitch(dom.reviewSizes, app.reviewSize, (size) => {
    app.reviewSize = size;
    renderMenu();
  });
  renderSizeSwitch(dom.learnSizes, app.learnSize, (size) => {
    app.learnSize = size;
    renderMenu();
  });
  dom.dueHint.hidden = due.length > 0;
  if (due.length === 0) {
    dom.dueHint.textContent = fresh.length
      ? 'На сегодня повторений нет. Можно учить новые карточки.'
      : 'На сегодня повторений нет — всё запланированное сделано.';
  }

  dom.toggleReview.checked = app.includeReview;
  dom.toggleReview.disabled = review.length === 0;
  dom.toggleReviewLabel.textContent = review.length
    ? `Включить карточки на проверке (${review.length})`
    : 'Включить карточки на проверке';

  dom.modeQuiz.setAttribute('aria-pressed', String(app.studyMode === 'quiz'));
  dom.modeRecall.setAttribute('aria-pressed', String(app.studyMode === 'recall'));

  const discussionCount = discussionEntries().length;
  dom.btnDiscussion.textContent = `На разбор — ${discussionCount}`;

  dom.btnNew.textContent = `Новые — ${fresh.length}`;
  dom.btnNew.disabled = fresh.length === 0;
  dom.btnErrors.textContent = `Отработать ошибки — ${errors.length}`;
  dom.btnErrors.disabled = errors.length === 0;
  dom.btnDismissErrors.disabled = errors.length === 0;
  dom.btnExport.disabled = app.cards.length === 0;

  dom.sectionsList.textContent = '';
  dom.menuEmpty.hidden = app.cards.length > 0;

  sections.forEach((sectionCards, name) => {
    const sectionAvailable = availableCards(sectionCards);
    const sectionScheduled = scheduledCards(sectionAvailable).length;
    const sectionDue = dueCards(sectionAvailable, now).length;

    const row = document.createElement('li');
    row.className = 'section-row';

    const main = document.createElement('div');
    main.className = 'section-row__main';

    const title = document.createElement('h2');
    title.className = 'section-row__title';
    title.textContent = name;

    const meta = document.createElement('p');
    meta.className = 'section-row__meta';
    meta.textContent = `Доступно: ${sectionAvailable.length} · В расписании: ${sectionScheduled} · `;
    const dueSpan = document.createElement('span');
    dueSpan.className = sectionDue ? 'has-errors' : '';
    dueSpan.textContent = `Сегодня: ${sectionDue}`;
    meta.appendChild(dueSpan);

    main.append(title, meta);

    const actions = document.createElement('div');
    actions.className = 'section-row__actions';

    const learnBtn = document.createElement('button');
    learnBtn.type = 'button';
    learnBtn.className = 'btn btn--primary';
    learnBtn.textContent = 'Учить';
    learnBtn.dataset.action = 'learn';
    learnBtn.dataset.section = name;
    learnBtn.disabled = sectionAvailable.length === 0;

    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'btn btn--danger';
    resetBtn.textContent = 'Сброс раздела…';
    resetBtn.dataset.action = 'reset';
    resetBtn.dataset.section = name;

    actions.append(learnBtn, resetBtn);
    row.append(main, actions);
    dom.sectionsList.appendChild(row);
  });

  renderSectionOptions(sections);
}

function renderSummaryStats(stats) {
  dom.summaryStats.textContent = '';
  stats.forEach((stat) => {
    const box = document.createElement('div');
    box.className = stat.className;

    const value = document.createElement('span');
    value.className = 'stat__value';
    value.textContent = stat.value;

    const label = document.createElement('span');
    label.className = 'stat__label';
    label.textContent = stat.label;

    box.append(value, label);
    dom.summaryStats.appendChild(box);
  });
}

/* Статистика: три слоя показаны раздельно, ничего не смешивается. */
function renderStats() {
  const totals = {
    training: { attempts: 0, correct: 0, hinted: 0, independent: 0, wrong: 0 },
    reviews: { attempts: 0, independent: 0, hinted: 0, failed: 0 },
    legacy: { seen: 0, correct: 0, wrong: 0 },
  };
  const rows = new Map();

  app.cards.forEach((card) => {
    const t = trainingEntry(card.id);
    const r = reviewsEntry(card.id);
    const l = progressEntry(card.id);
    if (!t.attempts && !r.attempts && !l.seen) return;

    const name = card.section || 'Без раздела';
    if (!rows.has(name)) {
      rows.set(name, {
        training: { attempts: 0, correct: 0 },
        reviews: { attempts: 0, independent: 0 },
        legacy: { seen: 0 },
      });
    }
    const row = rows.get(name);
    row.training.attempts += t.attempts;
    row.training.correct += t.correct;
    row.reviews.attempts += r.attempts;
    row.reviews.independent += r.independent;
    row.legacy.seen += l.seen;

    totals.training.attempts += t.attempts;
    totals.training.correct += t.correct;
    totals.training.hinted += t.hinted;
    totals.training.independent += t.independent;
    totals.training.wrong += t.wrong;
    totals.reviews.attempts += r.attempts;
    totals.reviews.independent += r.independent;
    totals.reviews.hinted += r.hinted;
    totals.reviews.failed += r.failed;
    totals.legacy.seen += l.seen;
    totals.legacy.correct += l.correct;
    totals.legacy.wrong += l.wrong;
  });

  dom.statsTotals.textContent = '';
  const blocks = [
    {
      value: String(totals.training.attempts),
      label: 'Тренировка: ответов',
      note: `верно ${totals.training.correct} · с вариантами ${totals.training.hinted} · по памяти ${totals.training.independent} · неверно ${totals.training.wrong}`,
      className: 'stat',
    },
    {
      value: String(totals.reviews.attempts),
      label: 'Повторения: оценок',
      note: `самостоятельно ${totals.reviews.independent} · с вариантами ${totals.reviews.hinted} · не вспомнил ${totals.reviews.failed}`,
      className: 'stat stat--accent',
    },
    {
      value: String(totals.legacy.seen),
      label: 'Старая история: ответов',
      note: `верно ${totals.legacy.correct} · неверно ${totals.legacy.wrong} · до разделения режимов`,
      className: 'stat',
    },
  ];

  blocks.forEach((block) => {
    const box = document.createElement('div');
    box.className = block.className;

    const value = document.createElement('span');
    value.className = 'stat__value';
    value.textContent = block.value;

    const label = document.createElement('span');
    label.className = 'stat__label';
    label.textContent = block.label;

    const note = document.createElement('span');
    note.className = 'stat__note';
    note.textContent = block.note;

    box.append(value, label, note);
    dom.statsTotals.appendChild(box);
  });

  const table = dom.statsTable;
  table.textContent = '';
  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  ['Раздел', 'Тренировка', 'Повторения', 'Старая история'].forEach((title) => {
    const th = document.createElement('th');
    th.textContent = title;
    headRow.appendChild(th);
  });
  head.appendChild(headRow);
  table.appendChild(head);

  const body = document.createElement('tbody');
  if (rows.size === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 4;
    td.textContent = 'Пока нет ни одной попытки.';
    tr.appendChild(td);
    body.appendChild(tr);
  }
  Array.from(rows.entries())
    .sort((a, b) => a[0].localeCompare(b[0], 'ru'))
    .forEach(([name, row]) => {
      const tr = document.createElement('tr');
      const cells = [
        name,
        row.training.attempts ? `${row.training.attempts} отв. · верно ${row.training.correct}` : '—',
        row.reviews.attempts ? `${row.reviews.attempts} оц. · самост. ${row.reviews.independent}` : '—',
        row.legacy.seen ? `${row.legacy.seen} отв.` : '—',
      ];
      cells.forEach((text) => {
        const td = document.createElement('td');
        td.textContent = text;
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
  table.appendChild(body);
}

function renderSectionOptions(sections) {
  dom.sectionOptions.textContent = '';
  sections.forEach((_cards, name) => {
    const option = document.createElement('option');
    option.value = name;
    dom.sectionOptions.appendChild(option);
  });
}

/* ---------- сессия ---------- */

function buildRound(pool, previousLastId) {
  const round = shuffle(pool);
  if (previousLastId && round.length > 1 && round[0].id === previousLastId) {
    const swapIndex = 1 + Math.floor(Math.random() * (round.length - 1));
    [round[0], round[swapIndex]] = [round[swapIndex], round[0]];
  }
  return round;
}

function startSession(cards, options) {
  const pool = cards.slice();
  if (pool.length === 0) {
    notify('Для этой сессии нет карточек.', 'info');
    return;
  }

  const activity = options.activity === 'review' ? 'review' : 'learn';
  const method = activity === 'review' ? 'recall' : (options.method || app.studyMode);

  app.session = {
    activity,
    method,
    title: options.title,
    reason: options.reason || activity,
    finite: Boolean(options.finite),
    pool,
    cards: activity === 'learn' ? buildRound(pool, null) : shuffle(pool),
    round: 1,
    index: 0,
    answered: 0,
    correct: 0,
    wrong: 0,
    hinted: 0,
    independent: 0,
    view: null,
    viewCardId: null,
    graded: new Set(),
  };

  showScreen('quiz');
  renderQuestion();
  window.scrollTo({ top: 0 });
}

/* Перемешанные варианты с сохранением исходного индекса.
   Исходная карточка и её correct_index не меняются. */
function buildView(card) {
  const order = shuffle(card.options.map((_, index) => index));
  return {
    options: order.map((originalIndex) => ({
      text: card.options[originalIndex],
      originalIndex,
    })),
    correctPosition: order.indexOf(card.correct_index),
  };
}

function renderQuestion() {
  const session = app.session;
  if (!session) return;

  const card = session.cards[session.index];
  app.answered = false;
  app.attemptRecorded = false;

  // Порядок фиксируется один раз на карточку: перерисовка (например,
  // переключение темы) не должна перемешивать варианты заново.
  if (session.viewCardId !== card.id) {
    session.view = buildView(card);
    session.viewCardId = card.id;
  }
  const view = session.view;
  const recall = session.method === 'recall';

  dom.quizCounter.textContent = session.activity === 'review'
    ? `Карточка ${session.index + 1} из ${session.cards.length}`
    : `Круг ${session.round} · карточка ${session.index + 1} из ${session.cards.length}`;

  dom.quizMode.textContent = session.activity === 'review'
    ? 'Повторение'
    : (recall ? 'Вспомнить' : 'Тест');

  dom.quizProgress.hidden = session.activity === 'learn';
  dom.quizProgressBar.style.width = session.activity === 'review'
    ? `${(session.index / session.cards.length) * 100}%`
    : '0%';

  dom.cardSection.textContent = [card.section, card.topic].filter(Boolean).join(' · ');
  dom.cardQuestion.textContent = card.question;

  if (card.needs_review) {
    dom.reviewBanner.hidden = false;
    dom.reviewBanner.textContent = 'Карточка на проверке: ' + (card.question_to_check
      || 'формулировка требует сверки с заметками.');
  } else {
    dom.reviewBanner.hidden = true;
    dom.reviewBanner.textContent = '';
  }

  dom.recallBox.hidden = !recall;
  dom.recallInput.value = '';
  dom.btnHint.hidden = !recall;
  dom.btnReveal.hidden = !recall;
  dom.btnHint.disabled = false;
  dom.btnReveal.disabled = false;

  dom.revealBox.hidden = true;
  dom.revealAnswer.textContent = '';
  dom.revealExplain.textContent = '';
  dom.revealVerdict.hidden = true;
  dom.revealVerdict.textContent = '';
  dom.btnAssessFailed.disabled = false;
  dom.btnAssessIndependent.disabled = false;

  dom.optionsList.textContent = '';
  dom.optionsList.hidden = recall;
  view.options.forEach((option, position) => {
    const item = document.createElement('li');

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'option';
    button.dataset.position = String(position);

    const key = document.createElement('span');
    key.className = 'option__key';
    key.textContent = String(position + 1);

    const label = document.createElement('span');
    label.className = 'option__text';
    label.textContent = option.text;

    button.append(key, label);
    button.addEventListener('click', () => selectOption(position));
    item.appendChild(button);
    dom.optionsList.appendChild(item);
  });

  dom.feedbackBox.hidden = true;
  dom.feedbackVerdict.textContent = '';
  dom.feedbackVerdict.className = 'feedback__verdict';
  dom.feedbackExplain.textContent = '';
  dom.feedbackMeta.textContent = '';
  dom.btnNext.hidden = true;
  dom.btnFinish.hidden = session.activity !== 'learn';
  updateDiscussButton(card.id);
}

/* position — позиция на экране, проверка идёт по исходному индексу варианта. */
/* position — позиция на экране, проверка идёт по исходному индексу варианта. */
function selectOption(position) {
  if (!app.session || app.answered) return;

  const session = app.session;
  const card = session.cards[session.index];
  const view = session.view;
  if (!view || !view.options[position]) return;
  if (session.activity === 'review' && session.graded.has(card.id)) return;

  const isRight = position === view.correctPosition;
  app.answered = true;
  app.attemptRecorded = true;

  const buttons = Array.from(dom.optionsList.querySelectorAll('.option'));
  buttons.forEach((button, index) => {
    button.disabled = true;
    if (index === view.correctPosition) button.classList.add('is-correct');
    if (index === position && !isRight) button.classList.add('is-wrong');
  });

  dom.feedbackVerdict.textContent = isRight
    ? 'Верно'
    : `Неверно. Правильный вариант: ${card.options[card.correct_index]}`;
  dom.feedbackVerdict.className = 'feedback__verdict ' + (isRight ? 'is-ok' : 'is-bad');
  dom.feedbackExplain.textContent = card.explanation;

  const meta = [];
  if (card.source_note) meta.push('Источник: ' + card.source_note);
  if (card.tags.length) meta.push('Теги: ' + card.tags.join(', '));
  if (session.activity === 'review') {
    meta.push(isRight
      ? 'Повторение записано с вариантами: следующий срок — завтра'
      : 'Повторение записано как невспомненное: карточка вернётся завтра');
  }
  if (card.needs_review) {
    meta.push('needs_review' + (card.question_to_check ? ': ' + card.question_to_check : ''));
  }
  dom.feedbackMeta.textContent = meta.join(' · ');

  dom.feedbackBox.hidden = false;

  recordAttempt(card, { activity: session.activity, mode: 'hinted', correct: isRight });
  if (session.activity === 'review') session.graded.add(card.id);

  session.answered += 1;
  if (isRight) {
    session.correct += 1;
    session.hinted += 1;
  } else {
    session.wrong += 1;
  }

  showNextButton();
}

/* Единая точка записи попытки: история (correct/wrong) и расписание. */
/* Единая точка записи попытки.
   «Учить»: тренировочная статистика + первая запись в расписании для новой
   карточки. Уже запланированные карточки не трогаются вообще.
   «Повторять»: результаты повторения + сдвиг расписания. */
function recordAttempt(card, options) {
  const activity = options.activity === 'review' ? 'review' : 'learn';
  const mode = options.mode === 'independent' ? 'independent' : 'hinted';
  const correct = Boolean(options.correct);

  let saved = true;

  // Новый провал после очистки списка возвращает карточку в список ошибок.
  if (!correct && app.dismissed[card.id]) {
    delete app.dismissed[card.id];
    saved = saveDismissed() && saved;
  }

  if (activity === 'review') {
    saved = updateReviews(card.id, mode, correct) && saved;
    const result = correct ? (mode === 'independent' ? 'independent' : 'hinted') : 'failed';
    saved = updateLearning(card.id, result) && saved;
  } else {
    saved = ensureLearningEntry(card) && saved;
    saved = updateTraining(card.id, mode, correct) && saved;
  }

  if (!saved) {
    notify(
      'Попытка засчитана в этой сессии, но сохранить её в браузере не удалось. ' +
      'После перезагрузки результат может пропасть.',
      'error',
    );
  }

  return saved;
}

function showNextButton() {
  const session = app.session;
  if (!session) return;

  const isLast = session.index + 1 >= session.cards.length;
  dom.btnNext.hidden = false;
  dom.btnNext.textContent = (session.activity === 'review' && isLast)
    ? 'Итоги повторения →'
    : 'Следующая карточка →';

  // Фокус без прокрутки: иначе страница прыгает вниз и объяснение уезжает из вида.
  try {
    dom.btnNext.focus({ preventScroll: true });
  } catch (err) {
    dom.btnNext.focus();
  }
}

/* ---------- режим «Вспомнить самостоятельно» ---------- */

function showHint() {
  const session = app.session;
  if (!session || app.answered || app.attemptRecorded) return;
  dom.optionsList.hidden = false;
  dom.btnHint.hidden = true;
  dom.btnReveal.hidden = true;
}

function revealAnswer() {
  const session = app.session;
  if (!session || app.answered || app.attemptRecorded) return;

  const card = session.cards[session.index];
  dom.btnHint.hidden = true;
  dom.btnReveal.hidden = true;
  dom.optionsList.hidden = true;
  dom.feedbackBox.hidden = true;

  dom.revealAnswer.textContent = 'Правильный ответ: ' + card.options[card.correct_index];
  dom.revealExplain.textContent = card.explanation;
  dom.revealVerdict.hidden = true;
  dom.revealBox.hidden = false;
  dom.btnAssessFailed.disabled = false;
  dom.btnAssessIndependent.disabled = false;
}

function formatDate(value) {
  const date = new Date(value);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}.${month}.${date.getFullYear()}`;
}

function assessRecall(independent) {
  const session = app.session;
  if (!session || app.attemptRecorded) return;

  const card = session.cards[session.index];
  if (session.activity === 'review' && session.graded.has(card.id)) return;

  app.attemptRecorded = true;
  dom.btnAssessFailed.disabled = true;
  dom.btnAssessIndependent.disabled = true;

  recordAttempt(card, { activity: session.activity, mode: 'independent', correct: independent });
  if (session.activity === 'review') session.graded.add(card.id);

  session.answered += 1;
  if (independent) {
    session.correct += 1;
    session.independent += 1;
  } else {
    session.wrong += 1;
  }

  const entry = learningEntry(card.id);
  dom.revealVerdict.hidden = false;

  if (session.activity === 'review') {
    dom.revealVerdict.textContent = independent
      ? `Отмечено: вспомнили самостоятельно. Следующее повторение — ${formatDate(entry.dueAt)}.`
      : 'Отмечено: не вспомнили. Карточка вернётся завтра.';
  } else {
    dom.revealVerdict.textContent = independent
      ? 'Отмечено: вспомнили самостоятельно. Расписание в тренировке не меняется.'
      : 'Отмечено: не вспомнили. Расписание в тренировке не меняется.';
  }

  showNextButton();
}

function goNext() {
  const session = app.session;
  if (!session || !(app.answered || app.attemptRecorded)) return;

  if (session.index + 1 < session.cards.length) {
    session.index += 1;
    renderQuestion();
    window.scrollTo({ top: 0 });
    return;
  }

  if (session.activity === 'review' || session.finite) {
    finishSession();
    return;
  }

  // «Учить» — бесконечные круги: новый круг без повтора последней карточки.
  const lastId = session.cards[session.cards.length - 1].id;
  session.cards = buildRound(session.pool, lastId);
  session.round += 1;
  session.index = 0;
  renderQuestion();
  window.scrollTo({ top: 0 });
}

function finishSession() {
  const session = app.session;
  if (!session) return;

  const isReview = session.activity === 'review';
  const answered = session.answered;
  const percent = answered ? Math.round((session.correct / answered) * 100) : 0;
  const remaining = isReview ? dueCards(availableCards(app.cards), new Date()).length : 0;

  if (isReview) {
    dom.summaryTitle.textContent = remaining > 0 ? 'Повторение приостановлено' : 'На сегодня всё';
    dom.summarySubtitle.textContent = remaining > 0
      ? `${session.title} · в этой сессии ${answered} · осталось повторений: ${remaining}`
      : `${session.title} · в этой сессии ${answered} · повторений на сегодня больше нет`;
  } else if (session.finite) {
    dom.summaryTitle.textContent = 'Тренировка завершена';
    dom.summarySubtitle.textContent =
      `${session.title} · карточек: ${session.cards.length} · ${percent}%`;
  } else {
    dom.summaryTitle.textContent = 'Тренировка завершена';
    dom.summarySubtitle.textContent =
      `${session.title} · кругов: ${session.round} · ${percent}%`;
  }

  const stats = isReview
    ? [
        { value: String(answered), label: 'Отвечено', className: 'stat' },
        { value: String(session.independent), label: 'Самостоятельно', className: 'stat stat--ok' },
        { value: String(session.hinted), label: 'С вариантами', className: 'stat' },
        { value: String(session.wrong), label: 'Не вспомнил', className: 'stat stat--bad' },
      ]
    : [
        { value: String(answered), label: 'Отвечено', className: 'stat' },
        { value: String(session.correct), label: 'Верно', className: 'stat stat--ok' },
        { value: String(session.hinted), label: 'С вариантами', className: 'stat' },
        { value: String(session.wrong), label: 'Неверно', className: 'stat stat--bad' },
      ];

  renderSummaryStats(stats);

  if (isReview) {
    if (remaining > 0) {
      dom.btnSummaryPrimary.textContent = 'Продолжить повторение';
      app.summaryPrimary = () => startReview();
    } else {
      dom.btnSummaryPrimary.textContent = 'Перейти в Учить';
      app.summaryPrimary = () => goToMenu();
    }
    const errors = errorCards(availableCards(app.cards)).length;
    dom.btnSummarySecondary.hidden = errors === 0;
    dom.btnSummarySecondary.textContent = `Отработать ошибки — ${errors}`;
    app.summarySecondary = () => startErrorsTraining();
  } else if (session.reason === 'mixed') {
    dom.btnSummaryPrimary.textContent = 'Ещё сессия';
    app.summaryPrimary = () => startMixedLearn();
    dom.btnSummarySecondary.hidden = true;
    app.summarySecondary = null;
  } else {
    dom.btnSummaryPrimary.textContent = 'Ещё круг';
    app.summaryPrimary = () => restartSession();
    dom.btnSummarySecondary.hidden = true;
    app.summarySecondary = null;
  }

  showScreen('summary');
  renderMenu();
  window.scrollTo({ top: 0 });
}

function restartSession() {
  const session = app.session;
  if (!session) {
    goToMenu();
    return;
  }

  if (session.activity === 'review') {
    goToMenu();
    return;
  }

  const cards = session.pool;
  if (!cards.length) {
    notify('В этом наборе больше нет карточек.', 'info');
    goToMenu();
    return;
  }

  startSession(cards, {
    activity: 'learn',
    title: session.title,
    reason: session.reason,
    method: session.method,
  });
}

/* ---------- запуск занятий ---------- */

function startLearn(cards, title, reason) {
  startSession(cards, {
    activity: 'learn',
    title,
    reason,
    method: app.studyMode,
  });
}

function startReview() {
  const due = dueCards(availableCards(app.cards), new Date());
  if (due.length === 0) {
    notify('На сегодня повторений нет.', 'info');
    return;
  }
  startSession(pickSample(due, app.reviewSize), {
    activity: 'review',
    title: 'Повторение',
    reason: 'due',
    finite: true,
  });
}

function startMixedLearn() {
  const sample = pickSample(availableCards(app.cards), app.learnSize);
  if (sample.length === 0) {
    notify('Нет доступных карточек.', 'info');
    return;
  }
  startSession(sample, {
    activity: 'learn',
    title: 'Все темы вперемешку',
    reason: 'mixed',
    finite: true,
  });
}

function startMixedEndless() {
  const pool = availableCards(app.cards);
  if (pool.length === 0) {
    notify('Нет доступных карточек.', 'info');
    return;
  }
  startSession(pool, {
    activity: 'learn',
    title: 'Все темы вперемешку',
    reason: 'mixed',
    finite: false,
  });
}

function startErrorsTraining() {
  const cards = errorCards(availableCards(app.cards));
  if (cards.length === 0) {
    notify('Список ошибок пуст.', 'info');
    return;
  }
  startLearn(cards, 'Отработка ошибок', 'errors');
}

function endLearn() {
  const session = app.session;
  if (!session || session.activity !== 'learn') return;
  if (session.answered === 0) {
    goToMenu();
    return;
  }
  finishSession();
}

function goToMenu() {
  app.session = null;
  renderMenu();
  showScreen('menu');
  window.scrollTo({ top: 0 });
}

/* ---------- действия с прогрессом ---------- */

/* Сброс раздела: показываем ровно то, что будет удалено. */
function resetSection(sectionName) {
  const cards = app.cards.filter((card) => card.section === sectionName);
  if (cards.length === 0) return;

  const counts = cards.reduce((acc, card) => {
    if (trainingEntry(card.id).attempts) acc.training += 1;
    if (reviewsEntry(card.id).attempts) acc.reviews += 1;
    if (progressEntry(card.id).seen) acc.legacy += 1;
    if (learningEntry(card.id)) acc.learning += 1;
    return acc;
  }, { training: 0, reviews: 0, legacy: 0, learning: 0 });

  const message = [
    `Сбросить данные раздела «${sectionName}»?`,
    '',
    'Будет удалено:',
    `• тренировочная статистика: ${counts.training} карточек`,
    `• результаты повторений: ${counts.reviews} карточек`,
    `• старая общая история: ${counts.legacy} карточек`,
    `• расписание: ${counts.learning} карточек (станут новыми)`,
    '• список ошибок по этому разделу очистится',
    '',
    'Не затронуто: свои карточки, тема, выбранный способ ответа.',
  ].join('\n');

  if (!window.confirm(message)) return;

  cards.forEach((card) => {
    delete app.training[card.id];
    delete app.reviews[card.id];
    delete app.progress[card.id];
    delete app.learning[card.id];
    delete app.dismissed[card.id];
  });

  const results = [saveTraining(), saveReviews(), saveProgress(), saveLearning(), saveDismissed()];
  renderMenu();

  if (!results.every(Boolean)) {
    notify('Сброс сохранён не полностью: часть данных может вернуться после перезагрузки.', 'error');
    return;
  }
  notify(`Данные раздела «${sectionName}» сброшены.`, 'success');
}

/* Очистка списка ошибок: только список, статистика и расписание не меняются. */
function dismissErrorList() {
  const cards = errorCards(availableCards(app.cards));
  if (cards.length === 0) {
    notify('Список ошибок пуст.', 'info');
    return;
  }

  const ok = window.confirm(
    `Очистить список ошибок (${cards.length} карточек)?\n\n` +
    'Убирается только список ошибок. Тренировочная статистика, результаты ' +
    'повторений, старая история и расписание останутся без изменений.',
  );
  if (!ok) return;

  const now = new Date().toISOString();
  cards.forEach((card) => {
    app.dismissed[card.id] = now;
  });

  if (!saveDismissed()) {
    notify('Не удалось сохранить список ошибок в браузере.', 'error');
    return;
  }

  renderMenu();
  notify(`Список ошибок очищен: ${cards.length} карточек.`, 'success');
}

/* ---------- добавление карточки ---------- */

function collectFormCard() {
  dom.optionInputs.forEach((input) => input.classList.remove('is-invalid'));
  [dom.fieldSection, dom.fieldTopic, dom.fieldQuestion, dom.fieldExplanation].forEach((input) => {
    input.classList.remove('is-invalid');
  });

  const section = dom.fieldSection.value.trim();
  const topic = dom.fieldTopic.value.trim();
  const question = dom.fieldQuestion.value.trim();
  const explanation = dom.fieldExplanation.value.trim();
  const optionValues = dom.optionInputs.map((input) => input.value.trim());
  const correctIndex = Number(dom.fieldCorrect.value);

  const problems = [];
  if (!section) {
    dom.fieldSection.classList.add('is-invalid');
    problems.push('раздел');
  }
  if (!topic) {
    dom.fieldTopic.classList.add('is-invalid');
    problems.push('тема');
  }
  if (!question) {
    dom.fieldQuestion.classList.add('is-invalid');
    problems.push('вопрос');
  }
  if (!explanation) {
    dom.fieldExplanation.classList.add('is-invalid');
    problems.push('объяснение');
  }

  optionValues.forEach((value, index) => {
    if (!value) {
      dom.optionInputs[index].classList.add('is-invalid');
      problems.push(`вариант ${index + 1}`);
    }
  });

  if (new Set(optionValues.filter(Boolean)).size !== optionValues.filter(Boolean).length) {
    problems.push('варианты не должны повторяться');
  }

  if (problems.length) {
    notify('Заполните поля: ' + problems.join(', ') + '.', 'error');
    return null;
  }

  const tags = dom.fieldTags.value
    .split(',')
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);

  return {
    id: uid('custom'),
    section,
    topic,
    difficulty: dom.fieldDifficulty.value,
    question,
    options: optionValues,
    correct_index: correctIndex,
    explanation,
    source_note: dom.fieldSource.value.trim() || 'добавлено вручную',
    tags,
    needs_review: false,
  };
}

function submitAddCard(event) {
  event.preventDefault();

  const card = collectFormCard();
  if (!card) return;

  app.customCards.push(card);

  if (!saveCustomCards()) {
    app.customCards.pop();
    notify('Карточка не сохранена: браузер не дал записать её в localStorage.', 'error');
    return;
  }

  rebuildCards();
  renderMenu();
  dom.addForm.reset();
  goToMenu();
  notify('Карточка добавлена в раздел «' + card.section + '».', 'success');
}

/* ---------- импорт / экспорт ---------- */

async function handleImportFile(file) {
  if (!file) return;

  let data;
  try {
    const text = await file.text();
    data = JSON.parse(text);
  } catch (err) {
    notify('Файл не является корректным JSON: ' + err.message, 'error');
    return;
  }

  let items = null;
  if (Array.isArray(data)) {
    items = data;
  } else if (data && Array.isArray(data.cards)) {
    items = data.cards;
  }

  if (!items) {
    notify('Ожидался массив карточек или объект вида { "cards": [ ... ] }.', 'error');
    return;
  }

  const existingIds = new Set(app.cards.map((card) => card.id));
  let added = 0;
  let skipped = 0;

  items.forEach((raw) => {
    const card = normalizeCard(raw);
    if (!card) {
      skipped += 1;
      return;
    }
    if (existingIds.has(card.id)) {
      card.id = uid('import');
    }
    existingIds.add(card.id);
    app.customCards.push(card);
    added += 1;
  });

  if (added > 0) {
    if (!saveCustomCards()) {
      app.customCards.splice(app.customCards.length - added, added);
      notify('Импорт не сохранён: браузер не дал записать карточки в localStorage. Ничего не добавлено.', 'error');
      return;
    }
    rebuildCards();
    renderMenu();
  }

  notify(`Импортировано карточек: ${added}. Пропущено некорректных: ${skipped}.`,
    added > 0 ? 'success' : 'error');
}

const BACKUP_SCHEMA_VERSION = 4;
const SUPPORTED_BACKUP_VERSIONS = [1, 2, 3, 4];

function downloadJson(payload, filename) {
  const blob = new Blob([payload], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportCards() {
  if (app.cards.length === 0) {
    notify('Экспортировать нечего: карточек нет.', 'error');
    return;
  }

  downloadJson(
    JSON.stringify(app.cards, null, 2),
    `devops-cards-${new Date().toISOString().slice(0, 10)}.json`,
  );
  notify(`Экспортировано карточек: ${app.cards.length}.`, 'success');
}

/* ---------- полная резервная копия ---------- */

function currentTheme() {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

function themeName(theme) {
  return theme === 'light' ? 'светлая' : 'тёмная';
}

function buildBackup() {
  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    theme: currentTheme(),
    'trainer.progress.v1': app.progress,
    'trainer.custom.v1': app.customCards,
    'trainer.learning.v1': app.learning,
    'trainer.training.v1': app.training,
    'trainer.reviews.v1': app.reviews,
    'trainer.errors-dismissed.v1': app.dismissed,
    'trainer.discussion.v1': app.discussion,
  };
}

function exportBackup() {
  const backup = buildBackup();
  downloadJson(
    JSON.stringify(backup, null, 2),
    `trainer-backup-${backup.exportedAt.slice(0, 10)}.json`,
  );
  notify(
    `Резервная копия сохранена: прогресс по ${Object.keys(app.progress).length} карточкам, ` +
    `расписание по ${Object.keys(app.learning).length}, своих карточек: ${app.customCards.length}.`,
    'success',
  );
}

/* Проверка раздела расписания. В копиях версии 1 его не было — это допустимо. */
/* Проверка раздела расписания. В копиях версии 1 и 2 его могло не быть. */
function validateLearningBackup(data, version) {
  if (version === 1) {
    return { ok: true, learning: {}, hasLearning: false };
  }

  const learning = data['trainer.learning.v1'];
  if (!learning || typeof learning !== 'object' || Array.isArray(learning)) {
    return { ok: false, error: 'нет объекта trainer.learning.v1' };
  }

  for (const [cardId, entry] of Object.entries(learning)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return { ok: false, error: `расписание карточки ${cardId} повреждено` };
    }
    // lastReviewedAt = null — карточка только добавлена обучением.
    if (!(entry.lastReviewedAt === null
      || (typeof entry.lastReviewedAt === 'string' && !Number.isNaN(Date.parse(entry.lastReviewedAt))))) {
      return { ok: false, error: `у карточки ${cardId} некорректный lastReviewedAt` };
    }
    if (typeof entry.dueAt !== 'string' || Number.isNaN(Date.parse(entry.dueAt))) {
      return { ok: false, error: `у карточки ${cardId} некорректный dueAt` };
    }
    if (!Number.isInteger(entry.intervalDays) || entry.intervalDays < 0) {
      return { ok: false, error: `у карточки ${cardId} intervalDays должен быть целым неотрицательным` };
    }
    if (!LEARNING_RESULTS.includes(entry.lastResult)) {
      return { ok: false, error: `у карточки ${cardId} неизвестный lastResult` };
    }
    if (!Number.isInteger(entry.independentSuccesses) || entry.independentSuccesses < 0) {
      return { ok: false, error: `у карточки ${cardId} некорректный independentSuccesses` };
    }
  }

  return { ok: true, learning, hasLearning: true };
}

/* training: attempts = correct + wrong, correct = hinted + independent */
function validateTrainingBackup(data, version) {
  if (version < 3) {
    return { ok: true, training: {}, hasTraining: false };
  }

  const training = data['trainer.training.v1'];
  if (!training || typeof training !== 'object' || Array.isArray(training)) {
    return { ok: false, error: 'нет объекта trainer.training.v1' };
  }

  for (const [cardId, entry] of Object.entries(training)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return { ok: false, error: `тренировочная статистика карточки ${cardId} повреждена` };
    }
    for (const field of ['attempts', 'correct', 'wrong', 'hinted', 'independent']) {
      if (!Number.isInteger(entry[field]) || entry[field] < 0) {
        return { ok: false, error: `у карточки ${cardId} поле ${field} должно быть целым неотрицательным` };
      }
    }
    if (entry.attempts !== entry.correct + entry.wrong) {
      return { ok: false, error: `у карточки ${cardId} attempts не равен correct + wrong` };
    }
    if (entry.correct !== entry.hinted + entry.independent) {
      return { ok: false, error: `у карточки ${cardId} correct не равен hinted + independent` };
    }
    if (!(entry.lastAt === null
      || (typeof entry.lastAt === 'string' && !Number.isNaN(Date.parse(entry.lastAt))))) {
      return { ok: false, error: `у карточки ${cardId} некорректный lastAt` };
    }
  }

  return { ok: true, training, hasTraining: true };
}

function validateReviewsBackup(data, version) {
  if (version < 3) {
    return { ok: true, reviews: {}, hasReviews: false };
  }

  const reviews = data['trainer.reviews.v1'];
  if (!reviews || typeof reviews !== 'object' || Array.isArray(reviews)) {
    return { ok: false, error: 'нет объекта trainer.reviews.v1' };
  }

  for (const [cardId, entry] of Object.entries(reviews)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return { ok: false, error: `результаты повторений карточки ${cardId} повреждены` };
    }
    for (const field of ['attempts', 'independent', 'hinted', 'failed']) {
      if (!Number.isInteger(entry[field]) || entry[field] < 0) {
        return { ok: false, error: `у карточки ${cardId} поле ${field} должно быть целым неотрицательным` };
      }
    }
    if (entry.attempts !== entry.independent + entry.hinted + entry.failed) {
      return { ok: false, error: `у карточки ${cardId} attempts не равен independent + hinted + failed` };
    }
    if (!(entry.lastAt === null
      || (typeof entry.lastAt === 'string' && !Number.isNaN(Date.parse(entry.lastAt))))) {
      return { ok: false, error: `у карточки ${cardId} некорректный lastAt` };
    }
  }

  return { ok: true, reviews, hasReviews: true };
}

function validateDiscussionBackup(data, version) {
  if (version < 4) {
    return { ok: true, discussion: {}, hasDiscussion: false };
  }

  const discussion = data['trainer.discussion.v1'];
  if (!discussion || typeof discussion !== 'object' || Array.isArray(discussion)) {
    return { ok: false, error: 'нет объекта trainer.discussion.v1' };
  }

  for (const [key, entry] of Object.entries(discussion)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return { ok: false, error: `запись «На разбор» ${key} повреждена` };
    }
    if (entry.cardId !== key || typeof entry.cardId !== 'string') {
      return { ok: false, error: `в записи ${key} cardId не совпадает с ключом` };
    }
    if (typeof entry.comment !== 'string' || entry.comment.length > DISCUSSION_COMMENT_LIMIT) {
      return { ok: false, error: `у записи ${key} некорректный комментарий` };
    }
    for (const field of ['createdAt', 'updatedAt']) {
      if (typeof entry[field] !== 'string' || Number.isNaN(Date.parse(entry[field]))) {
        return { ok: false, error: `у записи ${key} некорректная дата ${field}` };
      }
    }
    const snapshot = entry.snapshot;
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      return { ok: false, error: `у записи ${key} нет снимка карточки` };
    }
    if (typeof snapshot.question !== 'string' || !snapshot.question.trim()) {
      return { ok: false, error: `у записи ${key} пустой вопрос в снимке` };
    }
    if (!Array.isArray(snapshot.options)
      || snapshot.options.length < 2
      || snapshot.options.length > 8
      || !snapshot.options.every((option) => typeof option === 'string')) {
      return { ok: false, error: `у записи ${key} некорректные варианты в снимке` };
    }
    if (!Number.isInteger(snapshot.correct_index)
      || snapshot.correct_index < 0
      || snapshot.correct_index >= snapshot.options.length) {
      return { ok: false, error: `у записи ${key} correct_index не соответствует вариантам` };
    }
    if (typeof snapshot.explanation !== 'string') {
      return { ok: false, error: `у записи ${key} нет объяснения в снимке` };
    }
    if (snapshot.sources !== undefined
      && (!Array.isArray(snapshot.sources)
        || !snapshot.sources.every((url) => typeof url === 'string' && url.startsWith('https://')))) {
      return { ok: false, error: `у записи ${key} некорректные sources` };
    }
  }

  return { ok: true, discussion, hasDiscussion: true };
}

function validateDismissedBackup(data, version) {
  if (version < 3) {
    return { ok: true, dismissed: {}, hasDismissed: false };
  }
  const dismissed = data['trainer.errors-dismissed.v1'];
  if (!dismissed || typeof dismissed !== 'object' || Array.isArray(dismissed)) {
    return { ok: false, error: 'нет объекта trainer.errors-dismissed.v1' };
  }
  for (const [cardId, value] of Object.entries(dismissed)) {
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
      return { ok: false, error: `у карточки ${cardId} в списке ошибок некорректная дата` };
    }
  }
  return { ok: true, dismissed, hasDismissed: true };
}

function validateBackup(data) {
  const fail = (message) => ({ ok: false, error: message });

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return fail('ожидался JSON-объект резервной копии');
  }
  if (!SUPPORTED_BACKUP_VERSIONS.includes(data.schemaVersion)) {
    return fail(
      `неподдерживаемая версия схемы: ${JSON.stringify(data.schemaVersion)}, ` +
      `поддерживаются ${SUPPORTED_BACKUP_VERSIONS.join(', ')}`,
    );
  }
  if (typeof data.exportedAt !== 'string' || Number.isNaN(Date.parse(data.exportedAt))) {
    return fail('поле exportedAt отсутствует или не является датой');
  }
  if (data.theme !== 'light' && data.theme !== 'dark') {
    return fail('поле theme должно быть "light" или "dark"');
  }

  const progress = data['trainer.progress.v1'];
  if (!progress || typeof progress !== 'object' || Array.isArray(progress)) {
    return fail('нет объекта trainer.progress.v1');
  }
  for (const [cardId, entry] of Object.entries(progress)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return fail(`прогресс карточки ${cardId} повреждён`);
    }
    for (const field of ['seen', 'correct', 'wrong']) {
      if (!Number.isInteger(entry[field]) || entry[field] < 0) {
        return fail(`у карточки ${cardId} поле ${field} должно быть целым неотрицательным числом`);
      }
    }
    if (!(entry.lastWrongAt === null || typeof entry.lastWrongAt === 'string')) {
      return fail(`у карточки ${cardId} поле lastWrongAt должно быть строкой или null`);
    }
  }

  const custom = data['trainer.custom.v1'];
  if (!Array.isArray(custom)) {
    return fail('нет массива trainer.custom.v1');
  }
  const normalized = [];
  for (const raw of custom) {
    const card = normalizeCard(raw);
    if (!card) return fail('в trainer.custom.v1 есть некорректная карточка');
    normalized.push(card);
  }

  const learningResult = validateLearningBackup(data, data.schemaVersion);
  if (!learningResult.ok) return learningResult;

  const trainingResult = validateTrainingBackup(data, data.schemaVersion);
  if (!trainingResult.ok) return trainingResult;

  const reviewsResult = validateReviewsBackup(data, data.schemaVersion);
  if (!reviewsResult.ok) return reviewsResult;

  const dismissedResult = validateDismissedBackup(data, data.schemaVersion);
  if (!dismissedResult.ok) return dismissedResult;

  const discussionResult = validateDiscussionBackup(data, data.schemaVersion);
  if (!discussionResult.ok) return discussionResult;

  return {
    ok: true,
    schemaVersion: data.schemaVersion,
    progress,
    custom: normalized,
    learning: learningResult.learning,
    hasLearning: learningResult.hasLearning,
    training: trainingResult.training,
    hasTraining: trainingResult.hasTraining,
    reviews: reviewsResult.reviews,
    hasReviews: reviewsResult.hasReviews,
    dismissed: dismissedResult.dismissed,
    hasDismissed: dismissedResult.hasDismissed,
    discussion: discussionResult.discussion,
    hasDiscussion: discussionResult.hasDiscussion,
    theme: data.theme,
    exportedAt: data.exportedAt,
  };
}

async function restoreBackup(file) {
  if (!file) return;

  if (file.size > 5 * 1024 * 1024) {
    notify('Файл больше 5 МБ — такой размер резервной копии не поддерживается.', 'error');
    return;
  }

  let data;
  try {
    data = JSON.parse(await file.text());
  } catch (err) {
    notify('Файл не является корректным JSON: ' + err.message + '. Данные не изменены.', 'error');
    return;
  }

  const result = validateBackup(data);
  if (!result.ok) {
    notify('Резервная копия не подходит: ' + result.error + '. Данные не изменены.', 'error');
    return;
  }

  const when = new Date(result.exportedAt).toLocaleString('ru-RU');
  const lines = [
    `Восстановить резервную копию от ${when}?`,
    '',
    `Старая история: было ${Object.keys(app.progress).length} → станет ${Object.keys(result.progress).length}`,
    `Тренировка: было ${Object.keys(app.training).length} → станет ${Object.keys(result.training).length}`,
    `Повторения: было ${Object.keys(app.reviews).length} → станет ${Object.keys(result.reviews).length}`,
    `Расписание: было ${Object.keys(app.learning).length} → станет ${Object.keys(result.learning).length}`,
    `Список ошибок (скрытые): было ${Object.keys(app.dismissed).length} → станет ${Object.keys(result.dismissed).length}`,
    `Список «На разбор»: было ${Object.keys(app.discussion).length} → станет ${Object.keys(result.discussion).length}`,
    `Свои карточки: было ${app.customCards.length} → станет ${result.custom.length}`,
    `Тема: ${themeName(currentTheme())} → ${themeName(result.theme)}`,
    `Версия схемы копии: ${result.schemaVersion}`,
    '',
    'Перечисленные данные будут заменены целиком, отменить это нельзя.',
  ];

  const missing = [];
  if (!result.hasTraining) missing.push('тренировочная статистика');
  if (!result.hasReviews) missing.push('результаты повторений');
  if (!result.hasDismissed) missing.push('список ошибок');
  if (!result.hasDiscussion) missing.push('список «На разбор»');
  if (!result.hasLearning) missing.push('расписание');

  if (missing.length) {
    lines.push('');
    lines.push('Внимание: в этой копии нет части данных — ' + missing.join(', ') + '.');
    lines.push('После восстановления эти разделы будут пустыми:');
    if (!result.hasLearning) lines.push('• расписание пустое, все карточки станут «новыми»;');
    if (!result.hasTraining) lines.push('• тренировочная статистика пустая;');
    if (!result.hasReviews) lines.push('• результаты повторений пустые;');
    if (!result.hasDismissed) lines.push('• скрытых ошибок нет.');
    if (!result.hasDiscussion) lines.push('• список «На разбор» будет пустым.');
  }

  const wantCopy = window.confirm(
    'Перед заменой можно сохранить текущее состояние в файл.\n\n' +
    '«ОК» — сначала скачать текущую резервную копию, «Отмена» — продолжить без неё.',
  );
  if (wantCopy) exportBackup();

  if (!window.confirm(lines.join('\n'))) {
    notify('Восстановление отменено. Данные не изменены.', 'info');
    return;
  }

  app.progress = result.progress;
  app.customCards = result.custom;
  app.learning = result.learning;
  app.training = result.training;
  app.reviews = result.reviews;
  app.dismissed = result.dismissed;
  app.discussion = result.discussion;

  const saved = {
    'старая история': saveProgress(),
    'свои карточки': saveCustomCards(),
    'расписание': saveLearning(),
    'тренировка': saveTraining(),
    'повторения': saveReviews(),
    'список ошибок': saveDismissed(),
    'список «На разбор»': saveDiscussion(),
  };

  applyTheme(result.theme);
  try {
    localStorage.setItem(STORAGE.theme, result.theme);
  } catch (err) {
    console.warn('Тема не сохранилась', err);
  }
  rebuildCards();
  renderMenu();

  const failedKeys = Object.keys(saved).filter((key) => !saved[key]);
  if (failedKeys.length) {
    notify(
      'Не удалось записать в localStorage: ' + failedKeys.join(', ') + '. ' +
      'В памяти данные заменены, но после перезагрузки состояние может отличаться. ' +
      'Разные ключи пишутся отдельно — одной атомарной операции здесь нет.',
      'error',
    );
    return;
  }

  notify(
    `Восстановлено: тренировка ${Object.keys(result.training).length}, ` +
    `повторения ${Object.keys(result.reviews).length}, ` +
    `расписание ${Object.keys(result.learning).length}, ` +
    `на разбор ${Object.keys(result.discussion).length}, ` +
    `своих карточек ${result.custom.length}.`,
    'success',
  );
}

/* ---------- обработчики ---------- */

function bindEvents() {
  dom.btnTheme.addEventListener('click', toggleTheme);
  dom.brandLink.addEventListener('click', (event) => {
    event.preventDefault();
    goToMenu();
  });

  dom.sectionsList.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;

    const sectionName = button.dataset.section;
    const action = button.dataset.action;

    if (action === 'learn') {
      startLearn(
        availableCards(app.cards.filter((card) => card.section === sectionName)),
        sectionName,
        'section',
      );
    } else if (action === 'reset') {
      resetSection(sectionName);
    }
  });

  dom.btnDue.addEventListener('click', startReview);
  dom.btnMixed.addEventListener('click', startMixedLearn);
  dom.btnMixedEndless.addEventListener('click', startMixedEndless);

  dom.btnNew.addEventListener('click', () => {
    const cards = newCards(availableCards(app.cards));
    if (cards.length === 0) {
      notify('Новых карточек нет: все уже в расписании.', 'info');
      return;
    }
    startLearn(cards, 'Новые карточки', 'new');
  });

  dom.btnErrors.addEventListener('click', startErrorsTraining);
  dom.btnDismissErrors.addEventListener('click', dismissErrorList);

  dom.btnStats.addEventListener('click', () => {
    renderStats();
    showScreen('stats');
    window.scrollTo({ top: 0 });
  });
  dom.btnStatsBack.addEventListener('click', goToMenu);

  dom.modeQuiz.addEventListener('click', () => {
    app.studyMode = 'quiz';
    saveMode();
    renderMenu();
  });
  dom.modeRecall.addEventListener('click', () => {
    app.studyMode = 'recall';
    saveMode();
    renderMenu();
  });

  dom.toggleReview.addEventListener('change', () => {
    app.includeReview = dom.toggleReview.checked;
    renderMenu();
    notify(
      app.includeReview
        ? 'Карточки на проверке включены: они попадут в «Учить» и «Повторять».'
        : 'Карточки на проверке снова скрыты.',
      'info',
    );
  });

  dom.btnAddCard.addEventListener('click', () => {
    renderSectionOptions(groupBySection(app.cards));
    showScreen('add');
  });
  dom.btnCancelAdd.addEventListener('click', goToMenu);
  dom.addForm.addEventListener('submit', submitAddCard);

  dom.btnImport.addEventListener('click', () => dom.importInput.click());
  dom.importInput.addEventListener('change', async () => {
    const file = dom.importInput.files && dom.importInput.files[0];
    await handleImportFile(file);
    dom.importInput.value = '';
  });

  dom.btnExport.addEventListener('click', exportCards);

  dom.btnBackup.addEventListener('click', exportBackup);
  dom.btnRestore.addEventListener('click', () => dom.backupInput.click());
  dom.backupInput.addEventListener('change', async () => {
    const file = dom.backupInput.files && dom.backupInput.files[0];
    await restoreBackup(file);
    dom.backupInput.value = '';
  });

  dom.btnHint.addEventListener('click', showHint);
  dom.btnReveal.addEventListener('click', revealAnswer);
  dom.btnAssessFailed.addEventListener('click', () => assessRecall(false));
  dom.btnAssessIndependent.addEventListener('click', () => assessRecall(true));

  dom.btnNext.addEventListener('click', goNext);
  dom.btnFinish.addEventListener('click', endLearn);
  dom.btnQuizToMenu.addEventListener('click', goToMenu);
  dom.btnBackToMenu.addEventListener('click', goToMenu);

  dom.btnSummaryPrimary.addEventListener('click', () => {
    if (app.summaryPrimary) app.summaryPrimary();
  });
  dom.btnSummarySecondary.addEventListener('click', () => {
    if (app.summarySecondary) app.summarySecondary();
  });
  dom.btnSummaryMenu.addEventListener('click', goToMenu);

  dom.btnUpdateNow.addEventListener('click', applyUpdate);
  dom.btnUpdateLater.addEventListener('click', () => {
    dom.updateBanner.hidden = true;
  });

  dom.btnDiscuss.addEventListener('click', () => {
    const session = app.session;
    if (!session) return;
    openDiscussionForm(session.cards[session.index].id);
  });

  dom.btnDiscussion.addEventListener('click', () => {
    renderDiscussion();
    showScreen('discussion');
    window.scrollTo({ top: 0 });
  });
  dom.btnDiscussionBack.addEventListener('click', goToMenu);

  dom.discussionList.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const cardId = button.dataset.card;
    if (button.dataset.action === 'open') openDiscussionView(cardId);
    else if (button.dataset.action === 'edit') openDiscussionForm(cardId);
    else if (button.dataset.action === 'remove') removeDiscussionById(cardId);
  });

  dom.btnDiscussionSave.addEventListener('click', saveDiscussionFromForm);
  dom.btnDiscussionCancel.addEventListener('click', closeDiscussionForm);
  dom.btnDiscussionRemove.addEventListener('click', () => {
    const cardId = app.discussionFormCardId;
    closeDiscussionForm();
    if (cardId) removeDiscussionById(cardId);
  });
  dom.discussionModal.addEventListener('click', (event) => {
    if (event.target && event.target.dataset && event.target.dataset.closeDiscussion) {
      closeDiscussionForm();
    }
  });

  dom.btnDiscussionEditFromView.addEventListener('click', () => {
    if (app.discussionViewId) openDiscussionForm(app.discussionViewId);
  });
  dom.btnDiscussionRemoveFromView.addEventListener('click', () => {
    const cardId = app.discussionViewId;
    if (!cardId) return;
    if (!window.confirm('Убрать карточку из списка «На разбор»?')) return;
    removeDiscussionById(cardId, { silent: true });
    app.discussionViewId = null;
    renderDiscussion();
    showScreen('discussion');
  });
  dom.btnDiscussionViewBack.addEventListener('click', () => {
    renderDiscussion();
    showScreen('discussion');
    window.scrollTo({ top: 0 });
  });
  dom.btnDiscussionRefresh.addEventListener('click', refreshDiscussionSnapshot);
  dom.btnDiscussionCopy.addEventListener('click', copyDiscussion);
  dom.btnDiscussionDownload.addEventListener('click', downloadDiscussion);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !dom.discussionModal.hidden) closeDiscussionForm();
  });

  document.addEventListener('keydown', (event) => {
    if (dom['screen-quiz'].hidden) return;
    if (event.target instanceof HTMLElement && event.target.matches('input, textarea, select')) return;

    // Цифры соответствуют видимому порядку вариантов, а не исходному индексу.
    if (!app.answered && !dom.optionsList.hidden && /^[1-9]$/.test(event.key)) {
      const position = Number(event.key) - 1;
      const buttons = dom.optionsList.querySelectorAll('.option');
      if (position < buttons.length) {
        event.preventDefault();
        selectOption(position);
      }
      return;
    }

    if ((app.answered || app.attemptRecorded) && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      goNext();
    }
  });
}

/* ---------- PWA: офлайн-кеш и обновления ---------- */

let swRegistration = null;
let reloadingForUpdate = false;

async function checkOfflineReady() {
  if (!('caches' in window)) return;
  try {
    const names = await caches.keys();
    const name = names.find((item) => item.startsWith('devops-trainer-'));
    if (!name) return;

    const cache = await caches.open(name);
    const cached = (await cache.keys()).map((request) => request.url);
    const needed = ['app.js', 'styles.css', 'data/cards.json', 'manifest.webmanifest'];
    if (needed.every((file) => cached.some((url) => url.endsWith(file)))) {
      dom.offlineStatus.hidden = false;
    }
  } catch (err) {
    console.warn('Не удалось проверить офлайн-кеш', err);
  }
}

async function initServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'READY') checkOfflineReady();
  });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadingForUpdate) return;
    reloadingForUpdate = true;
    window.location.reload();
  });

  try {
    swRegistration = await navigator.serviceWorker.register('./sw.js', { scope: './' });

    if (swRegistration.waiting && navigator.serviceWorker.controller) {
      dom.updateBanner.hidden = false;
    }

    swRegistration.addEventListener('updatefound', () => {
      const installing = swRegistration.installing;
      if (!installing) return;
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          dom.updateBanner.hidden = false;
        }
      });
    });

    await checkOfflineReady();
  } catch (err) {
    console.warn('Service worker не зарегистрирован', err);
  }
}

function applyUpdate() {
  dom.updateBanner.hidden = true;
  const waiting = swRegistration && swRegistration.waiting;
  if (waiting) {
    waiting.postMessage({ type: 'SKIP_WAITING' });
    return;
  }
  window.location.reload();
}

/* ---------- запуск ---------- */

async function init() {
  cacheDom();
  initTheme();

  // Обработчики привязываем сразу, не дожидаясь загрузки карточек.
  bindEvents();

  app.progress = loadProgress();
  app.customCards = loadCustomCards();
  app.learning = loadLearning();
  app.training = loadTraining();
  app.reviews = loadReviews();
  app.dismissed = loadDismissed();
  app.discussion = loadDiscussion();
  app.studyMode = loadMode();

  await loadBaseCards();

  rebuildCards();
  renderMenu();

  if (app.cards.length === 0) {
    dom.menuSummary.textContent = 'Карточек нет';
  }

  initServiceWorker();
}

document.addEventListener('DOMContentLoaded', init);
