/* ===========================================================
 *  英语 · 单词轮盘
 *  —— 外壳沿用「英语连连看」，玩法换成：
 *     左边一列单词像行李箱密码锁一样上下拨动，一次只锁一个词；
 *     右边随机出几个中文，点对了提示「✓ 正确」并配音效。
 *  词库来自 words.js（window.WORD_BANK）
 * =========================================================== */
(function () {
  'use strict';

  /* ---------------- 小工具 ---------------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const rnd = n => Math.floor(Math.random() * n);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const canVibrate = typeof navigator.vibrate === 'function';

  /* ---------------- 设置持久化 ---------------- */
  const LS_KEY = 'enMatch.settings.v1';
  function loadSettings() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (e) { return {}; }
  }
  const settings = Object.assign({
    unit: 'U1', size: 6, opts: 4, mode: 'random',
    haptics: true, sound: true, speak: true, pos: true
  }, loadSettings());
  if ([3, 4, 5, 6].indexOf(settings.opts) < 0) settings.opts = 4;
  if (!(settings.size === 'ALL' || [4, 6, 8, 10].indexOf(Number(settings.size)) >= 0)) settings.size = 6;
  function saveSettings() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(settings)); } catch (e) { /* 忽略 */ }
  }

  /* ===========================================================
   *  📖 顺序模式（按书顺序）读到哪儿了
   * =========================================================== */
  const OKEY = 'enMatch.order.v1';
  function loadOrderPos() {
    try {
      const o = JSON.parse(localStorage.getItem(OKEY));
      return (o && typeof o === 'object') ? o : {};
    } catch (e) { return {}; }
  }
  const orderPos = loadOrderPos();
  function saveOrderPos() { try { localStorage.setItem(OKEY, JSON.stringify(orderPos)); } catch (e) { /* 忽略 */ } }

  /* ===========================================================
   *  学习记录：错题本 ❌ / 生词本 ⭐
   *  key 形如 "U1#12"，和 words.js 里的顺序一一对应
   * =========================================================== */
  const PKEY = 'enMatch.progress.v1';
  function loadProgress() {
    try {
      const p = JSON.parse(localStorage.getItem(PKEY)) || {};
      return { wrong: p.wrong || {}, star: p.star || {} };
    } catch (e) { return { wrong: {}, star: {} }; }
  }
  const progress = loadProgress();
  function saveProgress() { try { localStorage.setItem(PKEY, JSON.stringify(progress)); } catch (e) {} }

  const wrongCount = key => (progress.wrong[key] ? progress.wrong[key].n || 1 : 0);
  const isStarred = key => !!progress.star[key];
  const wrongTotal = () => Object.keys(progress.wrong).length;
  const starTotal = () => Object.keys(progress.star).length;
  const bookTotal = () => bookKeysOf('all').length;

  function markWrong(key) {
    const e = progress.wrong[key] || { n: 0, t: 0 };
    e.n = Math.min((e.n || 0) + 1, 9);
    e.t = Date.now();
    progress.wrong[key] = e;
    saveProgress(); syncCounts();
  }
  /** 答对了：错题次数 -1，减到 0 就表示掌握了，自动移出错题本 */
  function markRight(key) {
    const e = progress.wrong[key];
    if (!e) return false;
    e.n = (e.n || 1) - 1;
    if (e.n <= 0) { delete progress.wrong[key]; saveProgress(); syncCounts(); return true; }
    saveProgress(); syncCounts();
    return false;
  }
  function toggleStar(key) {
    let on;
    if (progress.star[key]) { delete progress.star[key]; on = false; }
    else { progress.star[key] = Date.now(); on = true; }
    saveProgress(); syncCounts();
    return on;
  }
  function removeFromBook(key) {
    delete progress.wrong[key];
    delete progress.star[key];
    saveProgress(); syncCounts();
  }
  function syncCounts() {
    const w = wrongTotal(), s = starTotal(), all = bookTotal();
    const set = (sel, v) => { const el = $(sel); if (el) el.textContent = v; };
    set('#cntWrong', w); set('#cntStar', s); set('#cntBook', all);
    set('#tabAllCnt', all); set('#tabWrongCnt', w); set('#tabStarCnt', s);
  }

  /* ===========================================================
   *  打卡（每天完成 1 轮就算打卡成功）
   * =========================================================== */
  const CKEY = 'enMatch.checkin.v1';
  function loadCheckin() {
    try {
      const c = JSON.parse(localStorage.getItem(CKEY)) || {};
      const days = c.days || {};
      let total = c.total;
      if (!total) {
        total = { rounds: 0, words: 0, secs: 0 };
        Object.keys(days).forEach(k => {
          total.rounds += days[k].rounds || 0;
          total.words += days[k].words || 0;
          total.secs += days[k].secs || 0;
        });
      }
      return { days: days, total: total };
    } catch (e) { return { days: {}, total: { rounds: 0, words: 0, secs: 0 } }; }
  }
  /* ===========================================================
   *  📦 数据基线：旧记录丢了，这里补一份
   *  只在本地「完全没有」打卡记录时写入一次，之后照常累计。
   *  想关掉：把 BASELINE.days / rounds / words 改成 0 即可。
   * =========================================================== */
  const BASELINE = { days: 34, rounds: 111, words: 4334, secsPerRound: 300 };
  function buildBaselineCheckin() {
    const days = {};
    const n = Math.max(1, BASELINE.days), R = BASELINE.rounds, W = BASELINE.words;
    const rBase = Math.floor(R / n), rMore = R % n;
    const wBase = Math.floor(W / n), wMore = W % n;
    const now = new Date();
    const keyOf = dt => dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
    let secs = 0;
    for (let ago = n - 1; ago >= 0; ago--) {
      const dt = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ago);
      const dr = rBase + (ago < rMore ? 1 : 0);
      const dw = wBase + (ago < wMore ? 1 : 0);
      days[keyOf(dt)] = { rounds: dr, words: dw, secs: dr * BASELINE.secsPerRound };
      secs += dr * BASELINE.secsPerRound;
    }
    return { days: days, total: { rounds: R, words: W, secs: secs } };
  }
  function seedBaseline() {
    try {
      const raw = localStorage.getItem(CKEY);
      const old = raw ? JSON.parse(raw) : null;
      const has = old && ((old.days && Object.keys(old.days).length) || (old.total && (old.total.rounds || old.total.words)));
      if (has) return false;
      localStorage.setItem(CKEY, JSON.stringify(buildBaselineCheckin()));
      return true;
    } catch (e) { return false; }
  }
  seedBaseline();
  const checkin = loadCheckin();
  function saveCheckin() { try { localStorage.setItem(CKEY, JSON.stringify(checkin)); } catch (e) {} }

  const dayKey = dt => dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
  const todayKey = () => dayKey(new Date());
  function shiftDay(key, delta) {
    const parts = key.split('-').map(Number);
    return dayKey(new Date(parts[0], parts[1] - 1, parts[2] + delta));
  }
  /** 连续天数：今天还没打卡就从昨天往前算（今天没结束，连续不断） */
  function streakNow() {
    let cur = todayKey(), s = 0;
    if (!checkin.days[cur]) cur = shiftDay(cur, -1);
    while (checkin.days[cur]) { s++; cur = shiftDay(cur, -1); }
    return s;
  }
  /** 历史上最长的一次连续 */
  function bestStreak() {
    const keys = Object.keys(checkin.days).sort();
    let best = 0, run = 0, prev = null;
    for (const k of keys) {
      run = (prev && shiftDay(prev, 1) === k) ? run + 1 : 1;
      if (run > best) best = run;
      prev = k;
    }
    return best;
  }
  const totalDays = () => Object.keys(checkin.days).length;
  const todayRec = () => checkin.days[todayKey()] || null;

  /** 记一轮的成绩；返回 true 表示今天第一次打卡成功 */
  function recordCheckin(pairs, secs) {
    const k = todayKey();
    const first = !checkin.days[k];
    const d = checkin.days[k] || { rounds: 0, words: 0, secs: 0 };
    d.rounds++; d.words += pairs; d.secs += secs;
    checkin.days[k] = d;
    checkin.total.rounds++;
    checkin.total.words += pairs;
    checkin.total.secs += secs;
    const keys = Object.keys(checkin.days).sort();
    if (keys.length > 730) keys.slice(0, keys.length - 730).forEach(x => delete checkin.days[x]);
    saveCheckin();
    syncCheckinCard();
    syncCounters();
    return first;
  }

  /** 首页的复习次数统计条 */
  function syncCounters() {
    const rec = todayRec();
    const t = checkin.total || { rounds: 0, words: 0 };
    const set = (sel, v, bump) => {
      const el = $(sel); if (!el) return;
      const old = el.textContent;
      el.textContent = v;
      if (bump && old !== String(v)) {
        const box = el.parentElement;
        box.classList.remove('bump'); void box.offsetWidth; box.classList.add('bump');
      }
    };
    set('#cTotal', t.rounds, true);
    set('#cToday', rec ? rec.rounds : 0, true);
    set('#cWords', t.words, false);
  }

  function syncCheckinCard() {
    const st = streakNow(), rec = todayRec();
    const card = $('#checkinCard');
    if (!card) return;
    card.classList.toggle('done', !!rec);
    $('#ccEmoji').textContent = rec ? '🔥' : '📅';
    $('#ccStreak').textContent = st;
    $('#ccToday').textContent = rec
      ? ('今天已打卡 · ' + rec.rounds + ' 轮 · ' + rec.words + ' 个词')
      : '今天还没打卡，玩一轮就行～';
  }

  /** 打卡日历：最近 10 周（按周排列，周日在最上面） */
  function renderCheckin() {
    const st = streakNow(), best = bestStreak(), total = totalDays(), rec = todayRec();
    $('#ckStreak').textContent = st;
    $('#ckBest').textContent = Math.max(best, st);
    $('#ckTotal').textContent = total;
    $('#ckSub').textContent = '连续 ' + st + ' 天' + (rec ? ' · 今天已打卡' : ' · 今天还没打卡');

    $('#ckToday').innerHTML = rec
      ? '🔥 今天打卡成功！练了 <b>' + rec.rounds + '</b> 次 · 答对 <b>' + rec.words + '</b> 个词 · ' +
        Math.max(1, Math.round(rec.secs / 60)) + ' 分钟<br>累计已复习 <b>' + checkin.total.rounds + '</b> 次 · 共答对 <b>' +
        checkin.total.words + '</b> 个词' +
        (st > 1 ? '<br>已经连着 <b>' + st + '</b> 天啦，别断哦～' : '')
      : (st > 0
        ? '今天还没打卡。已经连着打卡 <b>' + st + '</b> 天了，玩一轮就能接上 🔥<br>累计复习 <b>' + checkin.total.rounds + '</b> 次'
        : '今天还没打卡。完成 <b>1 轮</b>（把本轮单词全部答对）就算打卡成功～<br>累计复习 <b>' + checkin.total.rounds + '</b> 次');

    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay() - 63);
    const cells = [];
    for (let i = 0; i < 70; i++) {
      const dt = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const k = dayKey(dt);
      const d = checkin.days[k];
      const future = dt > today;
      const lv = !d ? 0 : d.words >= 41 ? 4 : d.words >= 21 ? 3 : d.words >= 9 ? 2 : 1;
      cells.push('<button class="ck-cell lv' + lv + (future ? ' future' : '') +
        (k === todayKey() ? ' today' : '') + '" data-day="' + k + '"' +
        (future ? ' disabled' : '') + ' aria-label="' + k + '"></button>');
    }
    $('#ckGrid').innerHTML = cells.join('');
  }

  function openCheckin() {
    renderCheckin();
    show('screen-checkin');
  }

  /* ===========================================================
   *  音效（Web Audio，无需素材文件）
   * =========================================================== */
  const Sound = {
    ctx: null,
    enabled: true,
    init() {
      if (this.ctx) return this.ctx;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { this.ctx = new AC(); } catch (e) { return null; }
      return this.ctx;
    },
    /** 唤醒音频上下文（iOS 必须在用户手势里调用） */
    unlock() {
      const c = this.init();
      if (c && c.state === 'suspended') c.resume().catch(() => {});
    },
    /** 单个音符 */
    tone(freq, dur, type, gain, delay) {
      if (!this.enabled) return;
      type = type || 'sine'; gain = gain === undefined ? 0.08 : gain; delay = delay || 0;
      const c = this.init(); if (!c) return;
      const t0 = c.currentTime + delay;
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = type; osc.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g); g.connect(c.destination);
      osc.start(t0); osc.stop(t0 + dur + 0.02);
    },
    /** 极短的低频「触感咔哒」：iOS 上没有真震动时用来代替手感 */
    thump(strength) {
      if (!this.enabled) return;
      strength = strength || 1;
      const c = this.init(); if (!c) return;
      const t0 = c.currentTime;
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(strength > 1 ? 66 : 92, t0);
      osc.frequency.exponentialRampToValueAtTime(40, t0 + 0.06);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.13 * strength, t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.075);
      osc.connect(g); g.connect(c.destination);
      osc.start(t0); osc.stop(t0 + 0.1);
    },
    /** 轮盘拨过一格的「咔哒」 */
    tick(strong) { this.tone(strong ? 1480 : 1080, 0.028, 'square', strong ? 0.03 : 0.011); },
    tap() { this.tone(880, 0.05, 'triangle', 0.045); },
    /** ✓ 答对：明亮四连音 */
    correct() {
      this.tone(659.25, 0.10, 'triangle', 0.085);
      this.tone(880.00, 0.12, 'triangle', 0.075, 0.055);
      this.tone(1318.5, 0.22, 'sine', 0.065, 0.11);
      this.tone(1760.0, 0.14, 'sine', 0.032, 0.19);
    },
    match() { this.tone(784, 0.12, 'sine', 0.09); this.tone(988, 0.14, 'sine', 0.08, 0.07); this.tone(1319, 0.2, 'sine', 0.07, 0.14); },
    error() { this.tone(196, 0.14, 'square', 0.05); this.tone(147, 0.18, 'square', 0.045, 0.09); },
    win() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.24, 'triangle', 0.08, i * 0.11)); }
  };

  /* ===========================================================
   *  触感反馈
   * =========================================================== */
  const Haptics = {
    enabled: true,
    bridge: null,
    patterns: {
      tap:   [10],
      soft:  [12],
      match: [18, 45, 70],
      error: [14, 30, 14],
      win:   [40, 55, 40, 55, 90]
    },
    fire(kind) {
      if (!this.enabled) return;
      const p = this.patterns[kind] || this.patterns.tap;
      if (typeof this.bridge === 'function') { try { this.bridge(kind); return; } catch (e) {} }
      try {
        const H = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Haptics;
        if (H) {
          if (kind === 'match' || kind === 'win') H.impact({ style: 'HEAVY' });
          else if (kind === 'error') H.impact({ style: 'MEDIUM' });
          else H.impact({ style: 'LIGHT' });
          return;
        }
      } catch (e) {}
      if (canVibrate) {
        try { navigator.vibrate(p); return; } catch (e) {}
      }
      if (settings.sound) {
        if (kind === 'match' || kind === 'win') Sound.thump(1.35);
        else if (kind === 'error') Sound.thump(0.9);
        else Sound.thump(0.6);
      }
    },
    tap()   { this.fire('tap'); },
    match() { this.fire('match'); },
    error() { this.fire('error'); },
    win()   { this.fire('win'); }
  };
  window.Haptics = Haptics;

  /* ===========================================================
   *  朗读
   * =========================================================== */
  function speak(text) {
    if (!settings.speak || !('speechSynthesis' in window)) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US'; u.rate = 0.92; u.pitch = 1.05;
      speechSynthesis.cancel();
      setTimeout(() => { try { speechSynthesis.speak(u); } catch (e) {} }, 40);
    } catch (e) {}
  }

  /* ===========================================================
   *  词库
   * =========================================================== */
  const BANK = window.WORD_BANK || {};
  const UNITS = Object.keys(BANK);
  function unitWords(u) { return (BANK[u] && BANK[u].words) || []; }
  function totalWords() { return UNITS.reduce((n, u) => n + unitWords(u).length, 0); }

  let _allWords = null;
  function allWords() {
    if (_allWords) return _allWords;
    const list = [];
    UNITS.forEach(u => unitWords(u).forEach((w, i) =>
      list.push({ key: u + '#' + (i + 1), en: w[0], zh: w[1], unit: u, no: i + 1 })));
    return (_allWords = list);
  }
  let _wordMap = null;
  function wordMap() {
    if (_wordMap) return _wordMap;
    _wordMap = new Map(allWords().map(w => [w.key, w]));
    return _wordMap;
  }
  function wordByKey(key) { return wordMap().get(key); }

  function buildPool(unit) {
    if (unit === 'STAR') return allWords().filter(w => progress.star[w.key]);
    if (unit === 'WRONG') return allWords().filter(w => progress.wrong[w.key]);
    if (unit === 'ALL') return allWords().slice();
    return allWords().filter(w => w.unit === unit);
  }

  /** 生词本 / 错题本里的词 key 列表；tab = all | wrong | star */
  function bookKeysOf(tab) {
    const out = new Set();
    if (tab === 'all' || tab === 'star') Object.keys(progress.star).forEach(k => out.add(k));
    if (tab === 'all' || tab === 'wrong') Object.keys(progress.wrong).forEach(k => out.add(k));
    const map = wordMap();
    return [...out].filter(k => map.has(k)).sort((a, b) => {
      const A = map.get(a), B = map.get(b);
      if (A.unit !== B.unit) return A.unit < B.unit ? -1 : 1;
      return A.no - B.no;
    });
  }

  /* ===========================================================
   *  游戏状态
   * =========================================================== */
  const state = {
    pool: [],
    poolLabel: null,
    forceRandom: false,
    roundWrongKeys: new Set(),
    roundWords: [],
    answered: new Set(),      // 本轮已答对的词 key
    optCache: new Map(),      // key -> 选项数组（来回滑动不会乱跳）
    distractors: null,        // 干扰项池：整个词库减去本轮这几个词
    idx: 0,                   // 轮盘位置（小数），0 = 第一个词在中间
    activeIdx: -1,            // 锁在中间那格的词下标
    locked: false,
    matched: 0,
    totalPairs: 0,
    combo: 0,
    maxCombo: 0,
    score: 0,
    wrong: 0,
    roundIndex: 0,
    startedAt: 0,
    elapsed: 0,
    timer: null,
    seen: new Set(),
    segStart: 0,
    segWrapped: false
  };

  const currentWord = () => state.roundWords[state.activeIdx] || null;

  function lenClass(s) {
    const n = String(s).length;
    if (n <= 9) return '';
    if (n <= 14) return 'fs-m';
    return 'fs-s';
  }
  function highlightPos(s) {
    const safe = escapeHtml(s);
    if (!settings.pos) return safe;
    return safe.replace(/(^|[\s,;，；、])((?:n|v|vt|vi|adj|adv|prep|conj|pron|num|art|int|aux|abbr)\.)/gi,
      '$1<i class="pos">$2</i>');
  }

  /* ===========================================================
   *  出词
   * =========================================================== */
  function pickWords(n) {
    const pool = state.pool;
    if (!state.forceRandom && settings.mode === 'order') {
      const total = pool.length;
      if (!total) return [];
      const cur = orderPosOf(settings.unit, total);
      const take = Math.min(n, total);
      const out = [];
      for (let i = 0; i < take; i++) out.push(pool[(cur + i) % total]);
      state.segStart = cur;
      state.segWrapped = (cur + take) > total;
      return out;
    }
    if (state.forceRandom) {
      return shuffle(pool).slice(0, Math.min(n, pool.length));
    }
    let avail = pool.filter(w => !state.seen.has(w.key));
    if (avail.length < n) {
      state.seen.clear();
      avail = pool.slice();
      if (pool.length > n * 2) toast('🎊 这个词库的词都过了一遍，重新开始抽～');
    }
    const picked = shuffle(avail).slice(0, Math.min(n, pool.length));
    picked.forEach(w => state.seen.add(w.key));
    return picked;
  }

  /* ---------------- 📖 顺序模式：位置 & 翻段 ---------------- */
  function orderPosOf(key, total) {
    let cur = Number(orderPos[key]);
    if (!Number.isFinite(cur) || cur < 0 || !total || cur >= total) cur = 0;
    return cur;
  }
  function orderPageSize(total) {
    if (settings.size === 'ALL') return Math.max(1, total || 1);
    return Math.max(1, Math.min(+settings.size || 6, total || 1));
  }
  /** 本轮要出多少个词：'ALL' = 一整个词库（整单元）的单词数 */
  function roundSize() {
    const total = state.pool.length || 1;
    if (settings.size === 'ALL') return total;
    return Math.max(1, Math.min(+settings.size || 6, total));
  }
  function unitLabel(u) {
    return u === 'ALL' ? '全部词库' : u === 'STAR' ? '⭐ 生词本' : u === 'WRONG' ? '❌ 错题本' : u;
  }
  function advanceOrderPos() {
    if (state.forceRandom || settings.mode !== 'order') return '';
    const total = state.pool.length;
    if (!total) return '';
    const start = Number.isFinite(state.segStart) ? state.segStart : orderPosOf(settings.unit, total);
    const step = Math.min(state.totalPairs || orderPageSize(total), total);
    orderPos[settings.unit] = (start + step) % total;
    saveOrderPos();
    if (state.segWrapped) return '📖 ' + unitLabel(settings.unit) + ' 已过完一遍，下一轮从第 1 词重新开始';
    return '📖 下一轮接着从第 ' + (orderPos[settings.unit] + 1) + ' 词开始';
  }
  function flipSegment(delta) {
    const total = state.pool.length;
    if (!total) { toast('这个词库没有词啦～'); return; }
    const page = orderPageSize(total);
    let cur = orderPosOf(settings.unit, total) + delta * page;
    let edge = '';
    if (cur >= total) { cur = 0; edge = '末尾'; }
    else if (cur < 0) { cur = Math.max(0, total - page); edge = '开头'; }
    orderPos[settings.unit] = cur;
    saveOrderPos();
    startRound();
    const to = Math.min(total, cur + page);
    toast(edge === '末尾' ? ('📖 已经到末尾了，从第 1 词重新开始')
      : edge === '开头' ? ('📖 已经是最前面了，从第 ' + (cur + 1) + ' 词开始')
        : (delta > 0 ? '⏭ 往后翻：第 ' + (cur + 1) + '–' + to + ' 词'
          : '⏮ 往前翻：第 ' + (cur + 1) + '–' + to + ' 词'));
  }
  function syncOrderUI() {
    const seg = $('#segBar');
    if (seg) seg.hidden = !(settings.mode === 'order' && !state.forceRandom);
    const note = $('#orderNote');
    if (!note) return;
    if (settings.mode !== 'order') { note.hidden = true; note.innerHTML = ''; return; }
    const total = buildPool(settings.unit).length;
    const page = orderPageSize(total);
    const cur = orderPosOf(settings.unit, total);
    const to = Math.min(total, cur + page);
    note.hidden = false;
    note.innerHTML = '📖 按书顺序：<b>' + escapeHtml(unitLabel(settings.unit)) + '</b> 下次从第 <b>' +
      (total ? (cur + 1) : 0) + '</b> / ' + total + ' 词开始' +
      (total ? '（第 ' + (cur + 1) + '–' + to + ' 词）' : '') +
      (cur > 0 ? ' · <button class="linkbtn" type="button" data-act="reset">回到开头</button>' : '') +
      (total && cur + page < total ? ' · <button class="linkbtn" type="button" data-act="next">跳到下一段 ›</button>' : '');
  }

  /* ===========================================================
   *  🎡 轮盘引擎
   *  一屏 5 格，中间那格就是「锁」到的词
   *  translateY = (2 - idx) * rowH
   * =========================================================== */
  const DRUM_ROWS = 5;
  const drumEl = () => $('#drum');
  const wrapEl = () => $('#drumWrap');

  const drum = {
    row: 64,
    raf: 0,
    animToken: 0,
    drag: null,
    suppressClick: 0,
    lastTickAt: 0,

    measure() {
      const vh = window.innerHeight || 640;
      const vw = Math.min(window.innerWidth || 390, 760);
      this.row = Math.round(clamp(Math.min(vh * 0.086, vw * 0.185), 46, 70));
      const wrap = wrapEl();
      if (wrap) {
        wrap.style.setProperty('--row', this.row + 'px');
        wrap.style.height = (this.row * DRUM_ROWS) + 'px';
      }
      this.apply();
    },

    build(words) {
      const ul = drumEl(); if (!ul) return;
      ul.innerHTML = '';
      const frag = document.createDocumentFragment();
      words.forEach((w, i) => {
        const li = document.createElement('li');
        li.className = 'drum-item ' + lenClass(w.en);
        li.dataset.idx = String(i);
        li.dataset.key = w.key;
        const check = document.createElement('span');
        check.className = 'di-check';
        check.textContent = '✓';
        const txt = document.createElement('span');
        txt.className = 'di-txt';
        txt.textContent = w.en;
        li.append(check, txt);
        frag.appendChild(li);
      });
      ul.appendChild(frag);
      this.measure();
    },

    items() {
      const ul = drumEl();
      return ul ? Array.from(ul.children) : [];
    },

    apply() {
      const ul = drumEl(); if (!ul) return;
      const y = (DRUM_ROWS / 2 - 0.5 - state.idx) * this.row;
      ul.style.transform = 'translate3d(0,' + y.toFixed(2) + 'px,0)';
    }
  };

  /** 设定轮盘位置；rubber = 拖动时允许轻微越界回弹 */
  function setIdx(v, rubber) {
    const n = state.roundWords.length;
    if (!n) { state.idx = 0; drum.apply(); return; }
    const hi = n - 1;
    let x = v;
    if (rubber) {
      if (x < 0) x = x * 0.3;
      if (x > hi) x = hi + (x - hi) * 0.3;
    } else {
      x = clamp(x, -1.2, hi + 1.2);
    }
    state.idx = x;
    drum.apply();
    const r = clamp(Math.round(x), 0, hi);
    if (r !== state.activeIdx) syncActive(r, true);
  }

  /** 中间那格换词 → 同步轮盘外观 + 右边选项 */
  function syncActive(r, playTick) {
    state.activeIdx = r;
    const items = drum.items();
    items.forEach((li, i) => {
      const d = Math.abs(i - r);
      const w = state.roundWords[i];
      li.classList.toggle('on', i === r);
      li.classList.toggle('near', d === 1);
      li.classList.toggle('far', d >= 2);
      li.classList.toggle('done', !!(w && state.answered.has(w.key)));
    });
    if (playTick) {
      const now = performance.now();
      if (now - drum.lastTickAt > 34) { drum.lastTickAt = now; Sound.tick(); }
    }
    renderOptions();
    syncQuizHead();
    if (r >= 0) hideHint();
  }

  function animateIdx(to, dur, done) {
    cancelAnimationFrame(drum.raf); drum.raf = 0;
    const n = state.roundWords.length;
    if (!n) return;
    to = clamp(to, 0, n - 1);
    const from = state.idx;
    if (Math.abs(to - from) < 0.002) { setIdx(to, false); if (done) done(); return; }
    const token = ++drum.animToken;
    const t0 = performance.now();
    const ease = p => 1 - Math.pow(1 - p, 3);
    let finished = false;
    function end() {
      if (finished || token !== drum.animToken) return;
      finished = true;
      cancelAnimationFrame(drum.raf); drum.raf = 0;
      setIdx(to, false);
      if (done) done();
    }
    function step(now) {
      if (token !== drum.animToken) return;
      const p = Math.min(1, (now - t0) / Math.max(1, dur));
      setIdx(from + (to - from) * ease(p), false);
      if (p < 1) drum.raf = requestAnimationFrame(step);
      else end();
    }
    drum.raf = requestAnimationFrame(step);
    // 兜底：个别环境（后台标签、无头浏览器）rAF 不回调时也要落位
    setTimeout(end, dur + 160);
  }

  /** 开场：轮盘从上面转进来 */
  function spinIn() {
    if (state.roundWords.length < 2) { setIdx(0, false); return; }
    state.idx = -1.15;
    drum.apply();
    animateIdx(0, 620);
  }

  /* ===========================================================
   *  右边：随机中文选项
   * =========================================================== */
  /**
   * 干扰项来源：整个词库（U1–U12 共 3792 词）随机抽，
   * 只排除本轮正在考的这几个词 —— 不局限当前单元，也不局限这一轮的单词。
   */
  function distractorSource() {
    if (state.distractors) return state.distractors;
    const roundKeys = new Set(state.roundWords.map(w => w.key));
    let list = allWords().filter(w => !roundKeys.has(w.key));
    // 「整单元」选到全库（3792 词）时，排除本轮就没剩几个了 —— 退回全库抽
    if (list.length < 40) list = allWords();
    state.distractors = list;
    return list;
  }

  function optionsFor(word) {
    const cached = state.optCache.get(word.key);
    if (cached) return cached;
    const want = clamp(settings.opts || 4, 3, 6);
    const src = distractorSource();
    const others = shuffle(src.filter(w => w.key !== word.key && w.zh !== word.zh));
    const picked = [];
    const seenZh = {};
    seenZh[word.zh] = 1;
    for (let i = 0; i < others.length && picked.length < want - 1; i++) {
      const zh = others[i].zh;
      if (!zh || seenZh[zh]) continue;
      seenZh[zh] = 1;
      picked.push(zh);
    }
    const list = shuffle([{ text: word.zh, ok: true }].concat(picked.map(t => ({ text: t, ok: false }))));
    state.optCache.set(word.key, list);
    return list;
  }

  function renderOptions() {
    const box = $('#opts'); if (!box) return;
    const w = currentWord();
    if (!w) { box.innerHTML = ''; return; }
    const opts = optionsFor(w);
    const done = state.answered.has(w.key);
    box.innerHTML = opts.map((o, i) => {
      const cls = 'opt' + (done ? (o.ok ? ' ok' : ' dim') : '');
      return '<button type="button" class="' + cls + '" data-i="' + i + '"' + (done ? ' disabled' : '') + '>' +
        '<span class="opt-mark">' + (done && o.ok ? '✓' : '') + '</span>' +
        '<span class="opt-txt">' + highlightPos(o.text) + '</span>' +
        '</button>';
    }).join('');
  }

  function syncQuizHead() {
    const head = $('#quizHead');
    if (!head) return;
    const w = currentWord();
    const n = state.roundWords.length;
    head.innerHTML = '<span id="quizNo">' + (state.activeIdx + 1) + ' / ' + n + '</span> · ' +
      (w && state.answered.has(w.key) ? '已答对 ✓' : '选一个正确的中文');
  }

  /* ===========================================================
   *  对 / 错
   * =========================================================== */
  function feedback(text, bad) {
    const feed = $('#quizFeed'), b = $('#feedBubble');
    if (!feed || !b) return;
    b.textContent = text;
    feed.classList.toggle('bad', !!bad);
    feed.classList.remove('show');
    void feed.offsetWidth;
    feed.classList.add('show');
  }

  function sparkle(el) {
    if (!el) return;
    const r = el.getBoundingClientRect();
    const colors = ['#ff9ec7', '#ffd76e', '#8fd3ff', '#8ee6a8', '#c9a7ff'];
    for (let i = 0; i < 7; i++) {
      const s = document.createElement('span');
      s.className = 'spark';
      s.style.left = (r.left + r.width / 2) + 'px';
      s.style.top = (r.top + r.height / 2) + 'px';
      s.style.background = colors[i % colors.length];
      const ang = Math.random() * Math.PI * 2, dist = 34 + Math.random() * 46;
      s.style.setProperty('--dx', Math.cos(ang) * dist + 'px');
      s.style.setProperty('--dy', Math.sin(ang) * dist + 'px');
      document.body.appendChild(s);
      setTimeout(() => s.remove(), 640);
    }
  }

  function onCorrect(w, optEl) {
    state.locked = true;
    state.answered.add(w.key);
    state.matched++;
    state.combo++;
    state.maxCombo = Math.max(state.maxCombo, state.combo);
    state.score += 10 + Math.min(state.combo - 1, 5) * 4;

    if (!state.roundWrongKeys.has(w.key)) {
      if (markRight(w.key)) toast('🎉 已掌握「' + w.en + '」，自动移出错题本');
    }

    Haptics.match();
    Sound.correct();
    if (settings.speak) speak(w.en);

    if (optEl) {
      optEl.classList.add('ok');
      const mark = optEl.querySelector('.opt-mark');
      if (mark) mark.textContent = '✓';
      Array.from($('#opts').children).forEach(b => {
        b.disabled = true;
        if (b !== optEl) b.classList.add('dim');
      });
      sparkle(optEl);
    }
    feedback('✓ 正确', false);
    syncQuizHead();

    const li = drum.items()[state.activeIdx];
    if (li) {
      li.classList.add('done', 'hit');
      setTimeout(() => li.classList.remove('hit'), 620);
      sparkle(li);
    }
    updateHud();

    const fromIdx = state.activeIdx;
    const finished = state.matched >= state.totalPairs;
    return wait(780).then(() => {
      state.locked = false;
      if (finished) { completeRound(); return; }
      const nxt = nextUnsolved(fromIdx);
      if (nxt >= 0 && nxt !== fromIdx) animateIdx(nxt, 340);
      else syncActive(state.activeIdx, false);
    });
  }

  function onWrong(w, optEl) {
    state.wrong++;
    state.combo = 0;
    state.roundWrongKeys.add(w.key);
    markWrong(w.key);
    Haptics.error();
    Sound.error();
    if (optEl) {
      optEl.classList.add('bad');
      setTimeout(() => optEl.classList.remove('bad'), 640);
    }
    const li = drum.items()[state.activeIdx];
    if (li) {
      li.classList.add('bump');
      setTimeout(() => li.classList.remove('bump'), 520);
    }
    feedback('再想想～', true);
    updateHud();
  }

  function nextUnsolved(fromIdx) {
    const n = state.roundWords.length;
    for (let k = 1; k <= n; k++) {
      const i = (fromIdx + k) % n;
      if (!state.answered.has(state.roundWords[i].key)) return i;
    }
    return -1;
  }

  function onPick(i) {
    if (state.locked) return;
    const w = currentWord();
    if (!w) return;
    if (state.answered.has(w.key)) return;
    const opts = optionsFor(w);
    const o = opts[i];
    if (!o) return;
    const el = $('#opts [data-i="' + i + '"]');
    Sound.unlock();
    if (o.ok) onCorrect(w, el);
    else onWrong(w, el);
  }

  /* ===========================================================
   *  一局的开始 / 重开
   * =========================================================== */
  function startRound() {
    const n = roundSize();
    state.roundWords = pickWords(n);
    if (!state.roundWords.length) {
      stopTimer();
      state.poolLabel = null;
      state.forceRandom = false;
      toast('这个词库没有词啦～换个词库继续吧');
      show('screen-menu');
      syncMenu();
      return;
    }
    state.roundIndex++;
    state.matched = 0;
    state.totalPairs = state.roundWords.length;
    state.combo = 0;
    state.maxCombo = 0;
    state.score = 0;
    state.wrong = 0;
    state.locked = false;
    state.answered = new Set();
    state.optCache = new Map();
    state.distractors = null;
    state.roundWrongKeys = new Set();
    state.activeIdx = -1;
    state.idx = 0;
    drum.build(state.roundWords);
    state.activeIdx = -1;
    setIdx(0, false);
    spinIn();
    startTimer();
    updateHud();
    syncOrderUI();
    showHint();
  }

  /** 用指定的一批词开一局（生词本练习 / 错题重练） */
  function startCustomRound(keys, label) {
    const map = wordMap();
    const list = keys.map(k => map.get(k)).filter(Boolean);
    if (!list.length) { toast('这里还没有词～先去玩几局吧'); return; }
    state.pool = list;
    state.poolLabel = label || '专属练习';
    state.forceRandom = true;
    state.roundIndex = 0;
    state.seen.clear();
    show('screen-game');
    startRound();
  }

  /** 主菜单开始的普通一局 */
  function startNormalRound() {
    state.pool = buildPool(settings.unit);
    state.poolLabel = null;
    state.forceRandom = false;
    if (!state.pool.length) {
      if (settings.unit === 'STAR' || settings.unit === 'WRONG') {
        toast(settings.unit === 'STAR'
          ? '⭐ 生词本还是空的：长按轮盘里的单词就能收藏，或者点错几道题'
          : '❌ 错题本还是空的：先去玩几局吧～');
        bookTab = settings.unit === 'STAR' ? 'star' : 'wrong';
        renderBook(); show('screen-book');
      } else {
        toast('这个词库是空的');
      }
      return;
    }
    state.roundIndex = 0;
    state.seen.clear();
    state.segStart = 0;
    state.segWrapped = false;
    show('screen-game');
    startRound();
  }

  function restartRound() {
    if (!state.roundWords.length) return;
    state.matched = 0; state.combo = 0; state.maxCombo = 0; state.score = 0; state.wrong = 0;
    state.locked = false;
    state.answered = new Set();
    state.optCache = new Map();
    state.distractors = null;
    state.roundWrongKeys = new Set();
    state.activeIdx = -1;
    state.idx = 0;
    drum.build(state.roundWords);
    state.activeIdx = -1;
    setIdx(0, false);
    spinIn();
    startTimer();
    updateHud();
  }

  /* ---------------- 计时 / HUD ---------------- */
  function startTimer() {
    clearInterval(state.timer);
    state.startedAt = Date.now();
    state.elapsed = 0;
    state.timer = setInterval(() => {
      state.elapsed = Math.floor((Date.now() - state.startedAt) / 1000);
      const el = $('#statTime'); if (el) el.textContent = fmtTime(state.elapsed);
    }, 500);
    const el = $('#statTime'); if (el) el.textContent = '0:00';
  }
  function stopTimer() {
    clearInterval(state.timer);
    state.timer = null;
    state.elapsed = Math.floor((Date.now() - state.startedAt) / 1000);
  }
  function fmtTime(s) { return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }

  function updateHud() {
    const total = state.totalPairs || 0;
    const done = state.matched || 0;
    const label = state.poolLabel || unitLabel(settings.unit);
    $('#tbTitle').textContent = label + ' · 第 ' + (state.roundIndex || 1) + ' 轮';
    $('#tbSub').textContent = '还剩 ' + Math.max(0, total - done) + ' / ' + total + ' 个词';
    $('#statCombo').textContent = '×' + state.combo;
    $('#statScore').textContent = state.score;
    const pct = total ? Math.round(done / total * 100) : 0;
    $('#progressBar').style.width = pct + '%';
  }

  /* ---------------- 结算 ---------------- */
  function completeRound() {
    stopTimer();
    Haptics.win();
    Sound.win();
    const accTotal = state.matched + state.wrong;
    const acc = accTotal ? Math.round(state.matched / accTotal * 100) : 100;
    const wrongN = state.roundWrongKeys.size;
    $('#resTime').textContent = fmtTime(state.elapsed);
    $('#resCombo').textContent = '×' + state.maxCombo;
    $('#resScore').textContent = state.score;
    $('#resAcc').textContent = acc + '%';
    $('#sheetEmoji').textContent = acc === 100 ? '🌟' : (acc >= 70 ? '🎉' : '💪');
    $('#sheetTitle').textContent = acc === 100 ? '完美通关！' : '本轮完成！';
    let sub = acc === 100 ? '一个都没错，太厉害啦～' : '记不住的多点几次就记住啦～';
    if (wrongN) sub += '（本轮错过的 ' + wrongN + ' 个词已自动进错题本）';
    $('#sheetSub').textContent = sub;
    const orderMsg = advanceOrderPos();
    if (orderMsg) $('#sheetSub').textContent += ' · ' + orderMsg;

    const retry = $('#btnRetryWrong');
    if (retry) {
      if (wrongN) {
        retry.hidden = false;
        retry.textContent = '❌ 重练本轮的 ' + wrongN + ' 个错词';
      } else {
        retry.hidden = true;
      }
    }

    const firstToday = recordCheckin(state.totalPairs, state.elapsed);
    const sc = $('#sheetCheckin');
    if (sc) {
      const st = streakNow();
      const tot = checkin.total.rounds;
      if (firstToday) {
        sc.innerHTML = '🎉 今天打卡成功！连续 <b>' + st + '</b> 天 · 累计第 <b>' + tot + '</b> 次复习' +
          (st > 1 ? '，继续保持 🔥' : '');
        sc.classList.add('show');
        setTimeout(() => { Haptics.fire('win'); Sound.tone(1568, 0.22, 'triangle', 0.07); }, 320);
      } else {
        const rec = todayRec();
        sc.innerHTML = '📅 今天已打卡 · 今天第 <b>' + (rec ? rec.rounds : 1) + '</b> 次 · 连续 <b>' + st +
          '</b> 天 · 累计第 <b>' + tot + '</b> 次';
        sc.classList.add('show');
      }
    }

    setTimeout(() => {
      if ($('#screen-game').classList.contains('is-active')) $('#overlay').classList.add('show');
    }, 260);
  }

  /* ===========================================================
   *  生词本 / 错题本页面
   * =========================================================== */
  let bookTab = 'all';
  let clearArmed = 0;

  function renderBook() {
    const keys = bookKeysOf(bookTab);
    $$('#bookTabs .chip').forEach(c => c.classList.toggle('on', c.dataset.tab === bookTab));
    syncCounts();
    $('#bookSub').textContent = '共 ' + keys.length + ' 个词';
    const btn = $('#btnPractice');
    btn.textContent = keys.length ? ('开始练习这 ' + keys.length + ' 个词') : '还没有可练习的词';
    btn.disabled = !keys.length;

    const list = $('#bookList');
    if (!keys.length) {
      const tip = bookTab === 'star'
        ? ['⭐', '生词本还是空的', '游戏里<b>长按轮盘上的单词</b>就能把那个词收藏进来']
        : bookTab === 'wrong'
          ? ['❌', '错题本是空的', '玩的时候点错的词会<b>自动</b>记到这里；<br>答对一次就减一次，掌握后自动移出']
          : ['📖', '这里还空空的', '点错的词会自动进错题本；<br>长按轮盘上的单词可以手动收藏进生词本'];
      list.innerHTML = '<div class="book-empty"><span class="big">' + tip[0] + '</span><b>' + tip[1] + '</b><br>' + tip[2] + '</div>';
      return;
    }

    const map = wordMap();
    list.innerHTML = keys.map(k => {
      const w = map.get(k);
      if (!w) return '';
      const n = wrongCount(k), st = isStarred(k);
      return '<div class="book-item' + (st ? ' is-star' : '') + (n ? ' is-wrong' : '') + '" data-key="' + k + '">' +
        '<div class="bi-main" data-act="speak">' +
          '<div class="bi-top"><span class="bi-en">' + escapeHtml(w.en) + '</span>' +
          '<span class="bi-no">' + w.unit + ' · ' + String(w.no).padStart(3, '0') + '</span></div>' +
          '<span class="bi-zh">' + highlightPos(w.zh) + '</span>' +
          '<div class="bi-badges">' +
            (n ? '<span class="badge wrong">错 ' + n + ' 次</span>' : '') +
            (st ? '<span class="badge star">⭐ 已收藏</span>' : '') +
          '</div>' +
        '</div>' +
        '<div class="bi-actions">' +
          '<button class="mini-btn' + (st ? ' on' : '') + '" data-act="star" aria-label="收藏">⭐</button>' +
          '<button class="mini-btn del" data-act="del" aria-label="移出">✕</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  /* ---------------- 轻提示 ---------------- */
  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1900);
  }

  /* ===========================================================
   *  页面切换
   * =========================================================== */
  function show(screen) {
    $$('.screen').forEach(s => s.classList.remove('is-active'));
    $('#' + screen).classList.add('is-active');
    if (screen === 'screen-game') window.scrollTo(0, 0);
  }

  function syncMenu() {
    renderUnitChips();
    syncCheckinCard();
    syncCounters();
    $$('#sizeChips .chip').forEach(c => c.classList.toggle('on', String(settings.size) === c.dataset.size));
    const allChip = $('#chipSizeAll');
    if (allChip) {
      const cnt = buildPool(settings.unit).length;
      allChip.textContent = (settings.unit === 'STAR' ? '⭐ 全部 ' : settings.unit === 'WRONG' ? '❌ 全部 ' : '整单元 ') + cnt;
    }
    $$('#optChips .chip').forEach(c => c.classList.toggle('on', +c.dataset.opts === settings.opts));
    $$('#modeChips .chip').forEach(c => c.classList.toggle('on', c.dataset.mode === settings.mode));
    $('#swHaptics').checked = settings.haptics;
    $('#swSound').checked = settings.sound;
    $('#swSpeak').checked = settings.speak;
    $('#swPos').checked = settings.pos;
    const n = totalWords();
    $('#totalWords').textContent = n;
    $('#bankHint').textContent = '共 ' + n + ' 词（' + UNITS.length + ' 个单元）';
    syncCounts();
    if (settings.unit === 'STAR' || settings.unit === 'WRONG') {
      const c = buildPool(settings.unit).length;
      $('#bankHint').textContent = settings.unit === 'STAR' ? ('⭐ 生词本里有 ' + c + ' 个词') : ('❌ 错题本里有 ' + c + ' 个词');
    }
    $('#hapticNote').textContent = canVibrate
      ? '📳 当前设备支持真实震动：拨轮盘轻震，答对重震。'
      : (isIOS
        ? '📳 iPhone / iPad 的浏览器不开放系统震动接口，已用「低频触感音 + 音效」模拟；装到安卓或套个原生壳就有真震动。'
        : '📳 当前浏览器不支持震动接口，已用「低频触感音 + 音效」代替。');
    syncOrderUI();
  }

  /* ---------------- 菜单：单元按钮（按词库自动生成） ---------------- */
  function renderUnitChips() {
    const box = $('#unitChips');
    if (!box) return;
    box.innerHTML =
      UNITS.map(u => '<button class="chip" data-unit="' + u + '">' + u + '</button>').join('') +
      '<button class="chip" data-unit="ALL">全部</button>' +
      '<button class="chip chip-special" data-unit="WRONG">❌ 错题本 <b class="cnt" id="cntWrong">0</b></button>' +
      '<button class="chip chip-special" data-unit="STAR">⭐ 生词本 <b class="cnt" id="cntStar">0</b></button>';
    $$('#unitChips .chip').forEach(c => c.classList.toggle('on', c.dataset.unit === settings.unit));
  }

  /* ===========================================================
   *  轮盘交互：拖动 / 甩动 / 点击 / 滚轮 / 键盘 / 长按收藏
   * =========================================================== */
  let longPressTimer = null, longPressFired = false, longPressFrom = null;

  function hideHint() {
    const h = $('#drumHint');
    if (h && !h.classList.contains('fade')) h.classList.add('fade');
  }
  function showHint() {
    const h = $('#drumHint');
    if (h) h.classList.remove('fade');
  }

  function cancelLongPress(e) {
    if (e && e.type === 'pointermove' && longPressFrom) {
      const dx = e.clientX - longPressFrom.x, dy = e.clientY - longPressFrom.y;
      if (dx * dx + dy * dy < 144) return;
    }
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
  function startLongPress(e) {
    cancelLongPress();
    longPressFired = false;
    longPressFrom = { x: e.clientX, y: e.clientY };
    const li = e.target && e.target.closest ? e.target.closest('.drum-item') : null;
    if (!li) return;
    const w = state.roundWords[+li.dataset.idx];
    if (!w) return;
    longPressTimer = setTimeout(() => {
      longPressTimer = null;
      longPressFired = true;
      const on = toggleStar(w.key);
      Haptics.match();
      toast(on ? ('⭐ 已加入生词本：' + w.en) : ('已从生词本移除：' + w.en));
    }, 550);
  }

  function onDrumDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!state.roundWords.length) return;
    const wrap = wrapEl(); if (!wrap) return;
    cancelAnimationFrame(drum.raf); drum.raf = 0;
    drum.drag = {
      id: e.pointerId,
      y0: e.clientY,
      idx0: state.idx,
      lastIdx: state.idx,
      lastT: performance.now(),
      v: 0,
      moved: false
    };
    wrap.classList.add('dragging');
    try { wrap.setPointerCapture(e.pointerId); } catch (err) {}
    Sound.unlock();
    startLongPress(e);
  }

  function onDrumMove(e) {
    const d = drum.drag;
    if (!d || e.pointerId !== d.id) return;
    const dy = e.clientY - d.y0;
    if (!d.moved && Math.abs(dy) > 6) { d.moved = true; cancelLongPress(); hideHint(); }
    const cur = d.idx0 - dy / drum.row;
    const now = performance.now();
    const dt = Math.max(1, now - d.lastT);
    d.v = d.v * 0.7 + ((cur - d.lastIdx) / dt) * 0.3;
    d.lastIdx = cur;
    d.lastT = now;
    setIdx(cur, true);
  }

  function onDrumUp(e) {
    const d = drum.drag;
    if (!d || (e && e.pointerId !== d.id)) return;
    drum.drag = null;
    clearTimeout(longPressTimer);
    const wrap = wrapEl();
    if (wrap) wrap.classList.remove('dragging');
    const n = state.roundWords.length;
    if (!n) return;
    if (d.moved) drum.suppressClick = performance.now() + 360;
    let target = Math.round(state.idx + Math.max(-2, Math.min(2, d.v * 130)));
    target = clamp(target, 0, n - 1);
    const dur = clamp(160 + Math.abs(target - state.idx) * 95, 160, 520);
    animateIdx(target, dur);
  }

  function onDrumClick(e) {
    if (performance.now() < drum.suppressClick) return;
    if (longPressFired) { longPressFired = false; return; }
    const li = e.target && e.target.closest ? e.target.closest('.drum-item') : null;
    if (!li) return;
    const i = +li.dataset.idx;
    if (i !== state.activeIdx) {
      Sound.tick(true);
      animateIdx(i, 300);
      return;
    }
    const w = state.roundWords[i];
    if (w) { Haptics.tap(); speak(w.en); }
  }

  function onDrumWheel(e) {
    if (!state.roundWords.length) return;
    e.preventDefault();
    const dir = e.deltaY > 0 ? 1 : -1;
    const n = state.roundWords.length;
    const target = clamp(Math.round(state.idx) + dir, 0, n - 1);
    hideHint();
    animateIdx(target, 200);
  }

  /* ===========================================================
   *  事件绑定
   * =========================================================== */
  function bind() {
    // 词库 / 单词数 / 选项数 / 模式
    $('#unitChips').addEventListener('click', e => {
      const c = e.target.closest('.chip'); if (!c) return;
      settings.unit = c.dataset.unit; saveSettings(); syncMenu(); Haptics.tap(); Sound.tap();
    });
    $('#sizeChips').addEventListener('click', e => {
      const c = e.target.closest('.chip'); if (!c) return;
      settings.size = (c.dataset.size === 'ALL') ? 'ALL' : +c.dataset.size; saveSettings(); syncMenu(); Haptics.tap(); Sound.tap();
    });
    $('#optChips').addEventListener('click', e => {
      const c = e.target.closest('.chip'); if (!c) return;
      settings.opts = +c.dataset.opts; saveSettings(); syncMenu(); Haptics.tap(); Sound.tap();
    });
    $('#modeChips').addEventListener('click', e => {
      const c = e.target.closest('.chip'); if (!c) return;
      settings.mode = c.dataset.mode; saveSettings(); syncMenu(); Haptics.tap(); Sound.tap();
    });

    if ($('#orderNote')) $('#orderNote').addEventListener('click', e => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const total = buildPool(settings.unit).length;
      if (!total) { toast('这个词库是空的'); return; }
      Haptics.tap(); Sound.tap();
      if (b.dataset.act === 'reset') {
        orderPos[settings.unit] = 0;
        saveOrderPos();
        syncMenu();
        toast('📖 已回到第 1 词');
        return;
      }
      const page = orderPageSize(total);
      let cur = orderPosOf(settings.unit, total) + page;
      if (cur >= total) cur = 0;
      orderPos[settings.unit] = cur;
      saveOrderPos();
      syncMenu();
      toast('⏭ 下次从第 ' + (cur + 1) + ' 词开始');
    });

    // 开关
    $('#swHaptics').addEventListener('change', e => {
      settings.haptics = e.target.checked; Haptics.enabled = settings.haptics;
      saveSettings(); if (settings.haptics) Haptics.tap();
    });
    $('#swSound').addEventListener('change', e => {
      settings.sound = e.target.checked; Sound.enabled = settings.sound;
      saveSettings(); Sound.unlock(); if (settings.sound) Sound.tap();
    });
    $('#swSpeak').addEventListener('change', e => { settings.speak = e.target.checked; saveSettings(); });
    $('#swPos').addEventListener('change', e => { settings.pos = e.target.checked; saveSettings(); });

    // 开始
    $('#btnStart').addEventListener('click', () => {
      Sound.unlock();
      Haptics.tap();
      startNormalRound();
      maybeShowLongPressHint();
    });

    // 打卡
    if ($('#checkinCard')) {
      $('#checkinCard').addEventListener('click', () => { Haptics.tap(); Sound.unlock(); openCheckin(); });
      $('#btnCheckinBack').addEventListener('click', () => { Haptics.tap(); show('screen-menu'); syncMenu(); });
      $('#ckGrid').addEventListener('click', e => {
        const c = e.target.closest('.ck-cell'); if (!c || c.disabled) return;
        const k = c.dataset.day, d = checkin.days[k];
        Haptics.tap(); Sound.tap();
        const p = k.split('-');
        const label = Number(p[1]) + '月' + Number(p[2]) + '日';
        toast(d
          ? (label + '：' + d.rounds + ' 轮 · ' + d.words + ' 个词 · ' + Math.max(1, Math.round(d.secs / 60)) + ' 分钟')
          : (label + '：没有打卡 😴'));
      });
    }

    // 游戏页
    $('#btnBack').addEventListener('click', () => { Haptics.tap(); stopTimer(); show('screen-menu'); syncMenu(); });
    $('#btnHome').addEventListener('click', () => { Haptics.tap(); stopTimer(); $('#overlay').classList.remove('show'); show('screen-menu'); syncMenu(); });
    $('#btnRestart').addEventListener('click', () => { Haptics.tap(); restartRound(); toast('↻ 已重开本轮'); });
    $('#btnSpeak').addEventListener('click', () => {
      const w = currentWord();
      Haptics.tap(); Sound.tap();
      if (w) speak(w.en); else toast('先滑到一个单词～');
    });

    // 📖 顺序模式：往后翻 / 往前翻一段
    if ($('#btnNextSeg')) $('#btnNextSeg').addEventListener('click', () => { Haptics.tap(); Sound.tap(); flipSegment(1); });
    if ($('#btnPrevSeg')) $('#btnPrevSeg').addEventListener('click', () => { Haptics.tap(); Sound.tap(); flipSegment(-1); });

    // 结算浮层
    $('#btnNext').addEventListener('click', () => { Haptics.tap(); $('#overlay').classList.remove('show'); startRound(); });
    $('#btnMenu2').addEventListener('click', () => { Haptics.tap(); $('#overlay').classList.remove('show'); stopTimer(); show('screen-menu'); syncMenu(); });
    $('#btnRetryWrong').addEventListener('click', () => {
      const keys = [...state.roundWrongKeys];
      Haptics.tap();
      $('#overlay').classList.remove('show');
      startCustomRound(keys, '❌ 错题重练');
    });

    // 生词本 / 错题本
    const openBook = (tab) => {
      if (tab) bookTab = tab;
      clearArmed = 0;
      renderBook();
      show('screen-book');
    };
    if ($('#btnBook')) $('#btnBook').addEventListener('click', () => { Haptics.tap(); openBook(); });
    $('#btnBookBack').addEventListener('click', () => { Haptics.tap(); show('screen-menu'); syncMenu(); });
    $('#bookTabs').addEventListener('click', e => {
      const c = e.target.closest('.chip'); if (!c) return;
      bookTab = c.dataset.tab; clearArmed = 0;
      Haptics.tap(); Sound.tap();
      renderBook();
    });
    $('#bookList').addEventListener('click', e => {
      const item = e.target.closest('.book-item'); if (!item) return;
      const key = item.dataset.key;
      const act = e.target.closest('[data-act]') ? e.target.closest('[data-act]').dataset.act : 'speak';
      if (act === 'star') {
        const on = toggleStar(key);
        Haptics.tap(); Sound.tap();
        renderBook();
        toast(on ? '⭐ 已收藏' : '已取消收藏');
        return;
      }
      if (act === 'del') {
        removeFromBook(key);
        Haptics.tap(); Sound.tap();
        renderBook();
        toast('已移出（当作已掌握了 👍）');
        return;
      }
      const w = wordByKey(key);
      if (w) { Haptics.tap(); Sound.tap(); speak(w.en); }
    });
    $('#btnBookClear').addEventListener('click', () => {
      const n = bookKeysOf(bookTab).length;
      if (!n) { toast('这里本来就是空的'); return; }
      const name = bookTab === 'star' ? '收藏' : bookTab === 'wrong' ? '错题记录' : '全部记录';
      if (!clearArmed) {
        clearArmed = Date.now();
        Haptics.tap();
        toast('再点一次「🗑️」就会清空' + n + '条' + name);
        return;
      }
      clearArmed = 0;
      if (bookTab === 'all') { progress.wrong = {}; progress.star = {}; }
      else if (bookTab === 'star') progress.star = {};
      else progress.wrong = {};
      saveProgress(); syncCounts(); renderBook();
      Haptics.error();
      toast('已清空' + n + '条' + name);
    });
    $('#btnPractice').addEventListener('click', () => {
      const keys = bookKeysOf(bookTab);
      Haptics.tap();
      startCustomRound(keys, bookTab === 'wrong' ? '❌ 错题重练' : bookTab === 'star' ? '⭐ 生词本练习' : '📖 生词练习');
    });

    // 轮盘
    const wrap = wrapEl();
    if (wrap) {
      wrap.addEventListener('pointerdown', onDrumDown);
      wrap.addEventListener('pointermove', onDrumMove);
      wrap.addEventListener('pointerup', onDrumUp);
      wrap.addEventListener('pointercancel', onDrumUp);
      wrap.addEventListener('pointerleave', e => { if (drum.drag) cancelLongPress(e); });
      wrap.addEventListener('click', onDrumClick);
      wrap.addEventListener('wheel', onDrumWheel, { passive: false });
    }

    // 选项（事件委托）
    const opts = $('#opts');
    if (opts) opts.addEventListener('click', e => {
      const b = e.target.closest('.opt'); if (!b || b.disabled) return;
      Haptics.tap();
      onPick(+b.dataset.i);
    });

    // 键盘：↑↓ 拨轮盘，1-6 选选项
    document.addEventListener('keydown', e => {
      if (!$('#screen-game').classList.contains('is-active')) return;
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (!state.roundWords.length) return;
        e.preventDefault();
        const n = state.roundWords.length;
        const target = clamp(Math.round(state.idx) + (e.key === 'ArrowDown' ? 1 : -1), 0, n - 1);
        hideHint();
        animateIdx(target, 180);
        return;
      }
      if (/^[1-6]$/.test(e.key)) {
        const i = +e.key - 1;
        if (i < (settings.opts || 4)) onPick(i);
      }
    });

    // 窗口尺寸变化 → 重新量一下格子高度
    window.addEventListener('resize', () => { drum.measure(); });
    window.addEventListener('orientationchange', () => setTimeout(() => drum.measure(), 260));
  }

  function maybeShowLongPressHint() {
    const HK = 'enMatch.hint.v2';
    try {
      if (localStorage.getItem(HK)) return;
      localStorage.setItem(HK, '1');
    } catch (e) { return; }
    setTimeout(() => toast('小提示：长按轮盘上的单词可以 ⭐ 收藏进生词本'), 1600);
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    Haptics.enabled = settings.haptics;
    Sound.enabled = settings.sound;
    Haptics.bridge = window.nativeHaptics || null;
    bind();
    syncMenu();
    syncCounts();
    window.addEventListener('pointerdown', () => Sound.unlock(), { once: true });
    if (!UNITS.length) {
      $('#bankHint').textContent = '⚠️ 没读到词库，请检查 words.js';
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
