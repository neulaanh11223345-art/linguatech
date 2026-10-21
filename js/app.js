/* LinguaTech v3 — logic giao diện (chạy trên GitHub Pages, không chứa khóa bí mật) */
(() => {
  'use strict';

  /* ---------- Cấu hình & lưu trữ cục bộ ---------- */
  const CFG = window.LINGUATECH_CONFIG || {};
  const KEY = { settings: 'lt3.settings', draft: 'lt3.draft', glossary: 'lt3.glossary', ui: 'lt3.ui' };
  const store = {
    get(k, fallback) { try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* bị chặn: bỏ qua */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* bỏ qua */ } }
  };
  const saved = Object(store.get(KEY.settings, {}));
  const settings = {
    url: typeof saved.url === 'string' ? saved.url : (CFG.APPS_SCRIPT_URL || ''),
    key: typeof saved.key === 'string' ? saved.key : (CFG.ACCESS_KEY || ''),
    injectTerms: saved.injectTerms === true,
    saveDraft: saved.saveDraft !== false
  };
  const ui = Object.assign({ dir: 'vi', mode: 'stack' }, Object(store.get(KEY.ui, {})));

  const LANG = {
    vi: { name: 'Tiếng Việt', badge: 'VI', upper: 'TIẾNG VIỆT', html: 'vi', api: 'vi' },
    zh: { name: 'Tiếng Trung', badge: '中', upper: '中文', html: 'zh-CN', api: 'zh-CN' }
  };
  const other = d => (d === 'vi' ? 'zh' : 'vi');

  /* ---------- Dữ liệu mẫu (chỉ dùng khi chưa kết nối) ---------- */
  const SAMPLE_TERMS = [
    { vi: 'Biến tần', zh: '变频器', group: 'Thiết bị điện', note: '' },
    { vi: 'Động cơ điện', zh: '电动机', group: 'Thiết bị điện', note: '' },
    { vi: 'Tủ điện', zh: '配电柜', group: 'Điện', note: '' },
    { vi: 'Tiếp địa', zh: '接地', group: 'An toàn điện', note: '' },
    { vi: 'Rơ le nhiệt', zh: '热继电器', group: 'Thiết bị điện', note: '' },
    { vi: 'Biến tần Mitsubishi FR-D740', zh: '三菱 FR-D740 变频器', group: 'Thiết bị điện', note: 'Giữ nguyên FR-D740' },
    { vi: 'Cảm biến tiệm cận', zh: '接近传感器', group: 'Cảm biến', note: '' },
    { vi: 'Cầu dao tự động', zh: '断路器', group: 'Thiết bị điện', note: '' },
    { vi: 'Ngắt nguồn điện', zh: '切断电源', group: 'An toàn điện', note: '' },
    { vi: 'Bảo trì', zh: '维护', group: 'Bảo trì', note: '' }
  ];
  const DEMO_PAIRS = [
    { vi: 'Kiểm tra biến tần Mitsubishi FR-D740 trước khi khởi động.', zh: '启动前检查三菱 FR-D740 变频器。' },
    { vi: 'Ngắt nguồn điện trước khi bảo trì.', zh: '维护前切断电源。' },
    { vi: 'Kiểm tra tình trạng tiếp địa của tủ điện.', zh: '检查配电柜的接地状况。' },
    { vi: 'Động cơ điện 3.5 kW bị quá nhiệt, rơ le nhiệt đã tác động.', zh: '3.5 kW 电动机过热，热继电器已动作。' },
    { vi: 'Kiểm tra lại dây L1/L2/L3 và PE.', zh: '重新检查 L1/L2/L3 和 PE 接线。' }
  ];
  const SAMPLE_LAYOUT = [[0, 1], [2], null, [3, 4]]; // mỗi phần tử là một dòng; null = dòng trống
  const sampleText = dir => SAMPLE_LAYOUT.map(line => (line ? line.map(i => DEMO_PAIRS[i][dir]).join(dir === 'vi' ? ' ' : '') : '')).join('\n');

  /* ---------- Tiện ích ---------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nfc = s => String(s ?? '').normalize('NFC');
  const fold = s => nfc(s).normalize('NFD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'd').toLowerCase();
  const compact = s => nfc(s).replace(/\s+/g, '');
  const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pad2 = n => String(n).padStart(2, '0');
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const icon = name => `<svg class="i"><use href="#i-${name}"/></svg>`;
  let seq = 0;
  const newId = () => 'g' + (++seq);

  /* ---------- Tách câu ---------- */
  // Chỉ tách ở dấu kết câu thật; không tách trong 3.5kW, M12x1.5, FR-D740, TP. HCM, "1." đầu dòng…
  const ABBR_END = /(?:^|[\s(])(?:TP|Tp|Q|P|St|Mr|Mrs|Ms|Dr|No|Nr|Co|Ltd|Inc|Corp|Fig|Ref|ThS|TS|PGS|GS|KS|Cty|vs|etc|v\.v|e\.g|i\.e|approx|max|min|Vol|pp)\.["'”’)\]]*$/;
  const LIST_MARK = /^\s*(?:\d{1,3}(?:\.\d{1,3})*|[a-zA-Z]|[IVXivx]{1,5})[.)]$/;
  const BOUNDARY = /[。！？]+[”’」』）"')\]]*|[.!?…]+[”’"')\]]*(?=\s|$)/g;

  function splitLine(line) {
    const parts = [];
    let start = 0, m;
    BOUNDARY.lastIndex = 0;
    while ((m = BOUNDARY.exec(line))) {
      const end = m.index + m[0].length;
      const piece = line.slice(start, end);
      const ch = m[0][0];
      if (ch === '.' || ch === '…') {
        const next = line.slice(end).trimStart().charAt(0);
        if (next && !/[\p{Lu}\p{N}"“'‘(\[\p{Script=Han}-]/u.test(next)) continue;
        if (ch === '.' && (ABBR_END.test(piece) || LIST_MARK.test(piece))) continue;
      }
      parts.push(piece);
      start = end;
    }
    if (start < line.length) parts.push(line.slice(start));
    return parts.map(s => s.trim()).filter(Boolean);
  }

  function segmentText(raw) {
    const units = [];
    let para = 0, gap = false;
    nfc(raw).replace(/\r\n?/g, '\n').split('\n').forEach(line => {
      if (!line.trim()) { if (units.length) gap = true; return; }
      if (gap) { para++; gap = false; }
      splitLine(line).forEach((text, i) => units.push({ text, para, lineStart: i === 0 }));
    });
    return units;
  }

  function detectLang(text) {
    const han = (text.match(/\p{Script=Han}/gu) || []).length;
    const lat = (text.match(/\p{Script=Latin}/gu) || []).length;
    if (han + lat < 6) return null;
    return han / (han + lat) > 0.3 ? 'zh' : 'vi';
  }

  /* ---------- Mã máy / số đo cần giữ nguyên ---------- */
  const CODE_RE = /(?<![\p{Script=Latin}\p{N}])[A-Za-z0-9]+(?:[-_/.:×*+][A-Za-z0-9]+)*(?![\p{Script=Latin}\p{N}])/gu;
  function findCodes(text) {
    const latin = (text.match(/\p{Script=Latin}/gu) || []).length;
    const upper = (text.match(/\p{Lu}/gu) || []).length;
    const shouting = latin > 12 && upper / latin > 0.6; // câu viết HOA toàn bộ: không coi chữ hoa là mã
    const out = [];
    for (const m of text.matchAll(CODE_RE)) {
      const t = m[0];
      if (/\d/.test(t)) { if (/^\d$/.test(t)) continue; }
      else if (shouting || /[a-z]/.test(t) || (t.match(/[A-Z]/g) || []).length < 2) continue;
      out.push({ start: m.index, end: m.index + t.length, text: t });
    }
    return out;
  }

  /* ---------- Thuật ngữ ---------- */
  let glossaryVersion = 0;
  let matcherCache = { key: '', list: [] };
  function getMatcher(dir) {
    const key = dir + '|' + glossaryVersion;
    if (matcherCache.key === key) return matcherCache.list;
    const seen = new Set(), list = [];
    for (const t of state.glossary.terms) {
      const src = nfc(dir === 'vi' ? t.vi : t.zh).trim(), tgt = nfc(dir === 'vi' ? t.zh : t.vi).trim();
      if (!src || !tgt) continue;
      const k = src.toLowerCase().replace(/\s+/g, ' ');
      if (seen.has(k)) continue; // trùng: lấy dòng đầu tiên trong Sheet
      seen.add(k);
      const body = src.split(/\s+/).map(escRe).join('\\s+');
      try {
        const re = dir === 'vi'
          ? new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, 'giu')
          : new RegExp(body, 'giu');
        list.push({ src, tgt, key: k, re });
      } catch { /* bỏ qua thuật ngữ lỗi */ }
    }
    list.sort((a, b) => b.src.length - a.src.length); // cụm dài được ưu tiên
    matcherCache = { key, list };
    return list;
  }

  function findTerms(text, list) {
    const hay = text.toLowerCase().replace(/\s+/g, ' ');
    const hits = [];
    for (const t of list) {
      if (!hay.includes(t.key)) continue;
      t.re.lastIndex = 0;
      let m;
      while ((m = t.re.exec(text))) {
        const s = m.index, e = s + m[0].length;
        if (!hits.some(h => s < h.end && e > h.start)) hits.push({ start: s, end: e, src: t.src, tgt: t.tgt });
      }
    }
    return hits.sort((a, b) => a.start - b.start);
  }

  // Chèn sẵn thuật ngữ đích vào câu nguồn để máy dịch giữ nguyên.
  function injectTerms(text, hits, dir) {
    let out = '', pos = 0;
    for (const h of hits) {
      let rep = h.tgt;
      if (dir === 'zh') {
        if (/^\p{Lu}\p{Ll}/u.test(rep) && !/\s\p{Lu}/u.test(rep)) rep = rep.charAt(0).toLowerCase() + rep.slice(1);
        rep = ` ${rep} `;
      }
      out += text.slice(pos, h.start) + rep;
      pos = h.end;
    }
    return (out + text.slice(pos))
      .replace(/ {2,}/g, ' ')
      .replace(/ ([，。！？；：、）」』])/g, '$1')
      .replace(/([，。！？；：、（「『]) /g, '$1')
      .trim();
  }

  function checkTranslation(seg, text) {
    const warns = [];
    const lower = compact(text).toLowerCase(), exact = compact(text);
    for (const h of seg.hits) {
      if (!lower.includes(compact(h.tgt).toLowerCase())) warns.push(`Thuật ngữ «${h.src}» → «${h.tgt}» không có trong bản dịch`);
    }
    for (const c of findCodes(seg.original)) {
      if (!exact.includes(compact(c.text))) warns.push(`Mã/số «${c.text}» không được giữ nguyên`);
    }
    return [...new Set(warns)];
  }

  /* ---------- Tô sáng ---------- */
  function markup(text, ranges) {
    const list = ranges.filter(r => r.end > r.start).sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
    let out = '', pos = 0;
    for (const r of list) {
      if (r.start < pos) continue;
      out += esc(text.slice(pos, r.start)) + `<mark class="${r.cls}"${r.title ? ` title="${esc(r.title)}"` : ''}>${esc(text.slice(r.start, r.end))}</mark>`;
      pos = r.end;
    }
    return out + esc(text.slice(pos));
  }
  const srcMarkup = seg => markup(seg.original, [
    ...seg.hits.map(h => ({ start: h.start, end: h.end, cls: 'hl-term', title: `Thuật ngữ → ${h.tgt}` })),
    ...findCodes(seg.original).map(c => ({ ...c, cls: 'hl-code', title: 'Mã/số phải giữ nguyên' }))
  ]);
  function tgtMarkup(seg, text) {
    const ranges = [];
    const add = (needle, cls, title) => {
      const parts = nfc(needle).trim().split(/\s+/).filter(Boolean);
      if (!parts.length) return;
      const re = new RegExp(parts.map(escRe).join('\\s*'), 'giu');
      for (const m of text.matchAll(re)) ranges.push({ start: m.index, end: m.index + m[0].length, cls, title });
    };
    seg.hits.forEach(h => add(h.tgt, 'hl-term', `Thuật ngữ: ${h.src} → ${h.tgt}`));
    findCodes(seg.original).forEach(c => add(c.text, 'hl-code', 'Mã/số giữ nguyên'));
    return markup(text, ranges);
  }

  /* ---------- Trạng thái ---------- */
  const state = {
    dir: ui.dir === 'zh' ? 'zh' : 'vi',
    mode: ['columns', 'inline'].includes(ui.mode) ? ui.mode : 'stack',
    segments: [],
    busy: false, progress: null,
    editingId: null, editDraft: '', focusEditor: false,
    glossary: { terms: [], source: 'demo' },
    glossaryLoading: false,
    conn: settings.url ? 'checking' : 'demo', connMsg: '',
    gloss: { q: '', group: '', limit: 150 }
  };
  const shown = s => (s.edited != null ? s.edited : s.machine);
  const statusOf = s => (s.status === 'loading' ? 'loading' : shown(s) != null ? 'done' : s.status);
  const saveUi = () => store.set(KEY.ui, { dir: state.dir, mode: state.mode });

  const el = {
    input: $('#sourceInput'), charCount: $('#charCount'), srcPill: $('#srcPill'), tgtPill: $('#tgtPill'), srcLangLabel: $('#srcLangLabel'),
    swap: $('#swapBtn'), detect: $('#detectHint'), translate: $('#translateBtn'), sample: $('#sampleBtn'), clear: $('#clearBtn'),
    modeStack: $('#modeStack'), modeColumns: $('#modeColumns'), modeInline: $('#modeInline'), modeHelp: $('#modeHelp'), summary: $('#summary'), banner: $('#banner'), output: $('#output'),
    copyTarget: $('#copyTargetBtn'), copyBi: $('#copyBiBtn'), download: $('#downloadBtn'),
    termBody: $('#termBody'), termSearch: $('#termSearch'), groupFilter: $('#groupFilter'), termInfo: $('#termInfo'), glossSub: $('#glossSub'),
    reload: $('#reloadBtn'), openSheet: $('#openSheetBtn'), more: $('#moreTermsBtn'), navTermCount: $('#navTermCount'), heroTerms: $('#heroTerms'),
    settingsDialog: $('#settingsDialog'), urlInput: $('#urlInput'), keyInput: $('#keyInput'), injectInput: $('#injectInput'), draftInput: $('#draftInput'),
    testBtn: $('#testBtn'), testResult: $('#testResult'), saveSettings: $('#saveSettingsBtn'),
    confirmDialog: $('#confirmDialog'), confirmText: $('#confirmText'), confirmYes: $('#confirmYes'), toast: $('#toast')
  };

  let toastTimer;
  function toast(msg, ms = 2800) {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('show'), ms);
  }

  function confirmBox(text, okLabel = 'Tiếp tục') {
    return new Promise(resolve => {
      el.confirmText.textContent = text;
      el.confirmYes.textContent = okLabel;
      const d = el.confirmDialog;
      let settled = false;
      const finish = ok => {
        if (settled) return;
        settled = true;
        d.removeEventListener('click', onClick);
        d.removeEventListener('cancel', onCancel);
        d.removeEventListener('close', onCancel);
        if (d.open) d.close();
        resolve(ok);
      };
      const onClick = e => { const b = e.target.closest('[data-confirm]'); if (b) finish(b.dataset.confirm === 'yes'); };
      const onCancel = () => finish(false);
      d.addEventListener('click', onClick);
      d.addEventListener('cancel', onCancel);
      d.addEventListener('close', onCancel);
      d.showModal();
    });
  }

  /* ---------- Gọi Apps Script ---------- */
  // POST với body chuỗi (Content-Type text/plain) => không có preflight CORS, chạy được từ GitHub Pages.
  async function api(payload, conf = settings, timeoutMs = 90000) {
    if (!conf.url) throw new Error('Chưa cấu hình URL Apps Script.');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const body = JSON.stringify(conf.key ? { ...payload, key: conf.key } : payload);
      const res = await fetch(conf.url, { method: 'POST', body, signal: ctrl.signal, redirect: 'follow' });
      const raw = await res.text();
      let data;
      try { data = JSON.parse(raw); } catch {
        throw new Error(res.ok ? 'Apps Script không trả về JSON — kiểm tra URL /exec và quyền truy cập “Bất kỳ ai”.' : `Lỗi HTTP ${res.status}.`);
      }
      if (!data || data.ok !== true) throw new Error((data && data.error) || 'Apps Script báo lỗi không rõ.');
      return data;
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('Quá thời gian chờ Apps Script.');
      if (err instanceof TypeError) throw new Error('Không gọi được Apps Script — kiểm tra mạng, URL /exec và quyền truy cập “Bất kỳ ai”.');
      throw err;
    } finally { clearTimeout(timer); }
  }

  /* ---------- Dịch ---------- */
  function chunk(segs, maxCount = 40, maxChars = 4000) {
    const out = [];
    let cur = [], size = 0;
    for (const s of segs) {
      const n = s.prepared.length + 1;
      if (cur.length && (cur.length >= maxCount || size + n > maxChars)) { out.push(cur); cur = []; size = 0; }
      cur.push(s);
      size += n;
    }
    if (cur.length) out.push(cur);
    return out;
  }

  function tidy(text, seg) {
    let t = nfc(text).trim();
    if (other(seg.dir) === 'vi' && t) t = t.charAt(0).toUpperCase() + t.slice(1);
    return t;
  }

  const normKey = s => nfc(s).toLowerCase().replace(/\s+/g, ' ').replace(/[。．.!?！？]+$/u, '').trim();
  function demoTranslate(s) {
    const t = other(s.dir), key = normKey(s.original);
    const hit = DEMO_PAIRS.find(p => normKey(p[s.dir]) === key) || state.glossary.terms.find(p => normKey(p[s.dir]) === key);
    if (hit) { s.machine = hit[t]; s.status = 'done'; } else s.status = 'offline';
  }

  function refreshWarnings(s) {
    const t = shown(s);
    s.warnings = t != null && s.status !== 'loading' ? checkTranslation(s, t) : [];
  }

  async function translateAll(fromButton = true) {
    if (state.busy) return;
    const raw = el.input.value;
    if (!raw.trim()) {
      if (fromButton) toast('Hãy nhập nội dung hoặc bấm “Nạp ví dụ”.');
      el.input.focus();
      return;
    }
    commitOpenEditor();
    const units = segmentText(raw);
    // Giữ lại các câu đã dịch / đã sửa nếu nguyên văn không đổi -> chỉ dịch phần mới.
    const pool = new Map();
    state.segments.forEach(s => { if (!pool.has(s.original)) pool.set(s.original, []); pool.get(s.original).push(s); });
    const next = units.map(u => {
      const prev = (pool.get(u.text) || []).shift();
      // Dùng lại bản dịch cũ nếu câu đã sửa tay, hoặc bảng thuật ngữ chưa đổi kể từ lúc dịch.
      if (prev && (prev.edited != null || (prev.machine != null && prev.gv === glossaryVersion))) return Object.assign(prev, { para: u.para, lineStart: u.lineStart });
      return { id: newId(), dir: state.dir, original: u.text, para: u.para, lineStart: u.lineStart, hits: [], prepared: '', machine: null, edited: null, status: 'pending', error: '', warnings: [] };
    });
    const keep = new Set(next);
    const lost = state.segments.filter(s => !keep.has(s) && s.edited != null).length;
    if (lost && !(await confirmBox(`${lost} câu đã sửa tay không còn trong văn bản mới nên sẽ bị bỏ. Tiếp tục dịch?`))) return;
    state.segments = next;
    if (fromButton && matchMedia('(max-width: 1100px)').matches) $('#result-area').scrollIntoView({ behavior: 'smooth', block: 'start' });
    const todo = next.filter(s => shown(s) == null);
    if (!todo.length) { render(); if (fromButton) toast('Tất cả câu đã có bản dịch.'); return; }
    await runJobs(todo);
  }

  async function runJobs(segs) {
    if (!segs.length) { render(); return; }
    const list = getMatcher(state.dir);
    for (const s of segs) {
      s.hits = findTerms(s.original, list);
      s.prepared = settings.injectTerms && s.hits.length ? injectTerms(s.original, s.hits, s.dir) : s.original;
      s.status = 'loading'; s.error = ''; s.warnings = []; s.gv = glossaryVersion; s.retried = false;
    }
    state.busy = true;
    state.progress = { done: 0, total: segs.length };
    render();
    try {
      if (!settings.url) {
        await new Promise(r => setTimeout(r, 300));
        segs.forEach(demoTranslate);
      } else {
        const batches = chunk(segs);
        for (let b = 0; b < batches.length; b++) {
          const batch = batches[b];
          try {
            const d = await api({ action: 'translate', source: LANG[state.dir].api, target: LANG[other(state.dir)].api, texts: batch.map(s => s.prepared) });
            batch.forEach((s, i) => {
              const r = (d.results || [])[i] || {};
              if (typeof r.text === 'string' && r.text.trim() && !r.error) { s.machine = tidy(r.text, s); s.status = 'done'; }
              else { s.status = 'error'; s.error = r.error || 'Không nhận được bản dịch.'; }
            });
          } catch (err) {
            batches.slice(b).flat().forEach(s => { s.status = 'error'; s.error = err.message; });
            break;
          }
          state.progress.done += batch.length;
          batch.forEach(refreshWarnings);
          render();
        }
        await enforceTerms(segs);
      }
    } finally {
      segs.forEach(refreshWarnings);
      state.busy = false;
      state.progress = null;
      render();
    }
    const errs = segs.filter(s => statusOf(s) === 'error');
    if (errs.length) toast(`${errs.length} câu dịch lỗi: ${errs[0].error}`, 5000);
  }

  // LanguageApp không nhận bảng thuật ngữ: dịch riêng từng thuật ngữ còn thiếu để biết máy dịch
  // gọi nó là gì (vd. "tủ điện" → 电气柜), rồi thay cách gọi đó bằng thuật ngữ chuẩn (配电柜).
  const hasTerm = (text, term) => compact(text).toLowerCase().includes(compact(term).toLowerCase());
  // Viết thường chữ đầu của thuật ngữ tiếng Việt khi nó nằm giữa câu (Tủ điện → tủ điện).
  const midVi = (term, offset, text) => (offset > 0 && !/[.!?:]\s*$/.test(text.slice(0, offset)) && /^\p{Lu}\p{Ll}/u.test(term) && !/\s\p{Lu}/u.test(term))
    ? term.charAt(0).toLowerCase() + term.slice(1) : term;

  async function enforceTerms(segs) {
    await replaceByTermTranslation(segs);
    await retryWithPlaceholders(segs);
  }

  async function replaceByTermTranslation(segs) {
    const has = hasTerm;
    const missing = new Map();
    for (const s of segs) {
      if (s.status !== 'done' || s.machine == null) continue;
      for (const h of s.hits) if (!has(s.machine, h.tgt)) missing.set(h.src.toLowerCase(), h.src);
    }
    if (!missing.size) return;
    const keys = [...missing.keys()].slice(0, 150);
    let res;
    try {
      res = await api({ action: 'translate', source: LANG[state.dir].api, target: LANG[other(state.dir)].api, texts: keys.map(k => missing.get(k)) });
    } catch { return; } // không thay được thì giữ nguyên, cảnh báo vẫn hiện
    const mtOf = new Map(keys.map((k, i) => [k, nfc(((res.results || [])[i] || {}).text || '').replace(/[。．.!?！？]+$/u, '').trim()]));
    const toVi = other(state.dir) === 'vi';
    for (const s of segs) {
      if (s.status !== 'done' || s.machine == null) continue;
      let text = s.machine;
      for (const h of s.hits) {
        if (has(text, h.tgt)) continue;
        const mt = mtOf.get(h.src.toLowerCase());
        if (!mt || has(mt, h.tgt)) continue;
        const re = new RegExp(mt.split(/\s+/).map(escRe).join('\\s*'), 'giu');
        text = text.replace(re, (m, offset, whole) => (toVi ? midVi(h.tgt, offset, whole) : h.tgt));
      }
      if (text !== s.machine) { s.machine = tidy(text, s); refreshWarnings(s); }
    }
  }

  // Câu vẫn thiếu thuật ngữ: dịch lại riêng câu đó, thay thuật ngữ bằng mã giữ chỗ (ZX01…) mà máy dịch
  // luôn giữ nguyên, rồi đổi mã thành thuật ngữ chuẩn. Chỉ nhận kết quả khi mọi mã còn nguyên.
  async function retryWithPlaceholders(segs) {
    const jobs = [];
    for (const s of segs) {
      if (s.status !== 'done' || s.machine == null) continue;
      if (s.hits.every(h => hasTerm(s.machine, h.tgt))) continue;
      // Thay mã cho mọi thuật ngữ trong câu: bản dịch lại thay thế toàn bộ bản cũ.
      let text = '', pos = 0, n = 0;
      const map = [];
      for (const h of s.hits) {
        let tok;
        do { tok = 'ZX' + pad2(++n); } while (s.original.includes(tok));
        text += s.original.slice(pos, h.start) + tok;
        pos = h.end;
        map.push([tok, h.tgt]);
      }
      jobs.push({ s, text: text + s.original.slice(pos), map });
    }
    if (!jobs.length) return;
    const toVi = other(state.dir) === 'vi';
    for (const batch of chunk(jobs.map(j => Object.assign(j, { prepared: j.text })))) {
      let res;
      try {
        res = await api({ action: 'translate', source: LANG[state.dir].api, target: LANG[other(state.dir)].api, texts: batch.map(j => j.text) });
      } catch { return; }
      batch.forEach((j, i) => {
        let t = ((res.results || [])[i] || {}).text;
        if (typeof t !== 'string' || !j.map.every(([tok]) => t.includes(tok))) return;
        for (const [tok, term] of j.map) t = t.replace(new RegExp(tok, 'g'), (m, offset, whole) => (toVi ? midVi(term, offset, whole) : term));
        if (!toVi) t = t.replace(/(\p{Script=Han})\s+(?=\p{Script=Han})/gu, '$1').replace(/\s+(?=[，。！？；：、])/gu, '');
        j.s.machine = tidy(t, j.s);
        j.s.retried = true;
        refreshWarnings(j.s);
      });
    }
  }

  async function retrySeg(seg) {
    if (state.busy) return;
    if (seg.edited != null && !(await confirmBox('Câu này đã được sửa tay. Dịch lại sẽ bỏ bản sửa. Tiếp tục?', 'Dịch lại'))) return;
    seg.edited = null;
    seg.machine = null;
    await runJobs([seg]);
  }

  /* ---------- Sửa bản dịch ---------- */
  function applyEdit(seg, value) {
    const v = nfc(value).trim();
    seg.edited = !v || v === seg.machine ? null : v;
    refreshWarnings(seg);
  }
  function commitOpenEditor() {
    if (!state.editingId) return;
    const seg = state.segments.find(s => s.id === state.editingId);
    const ta = $('.editor-input', el.output);
    if (seg) applyEdit(seg, ta ? ta.value : state.editDraft);
    state.editingId = null;
  }
  function startEdit(seg) {
    commitOpenEditor();
    state.editingId = seg.id;
    state.editDraft = shown(seg) ?? '';
    state.focusEditor = true;
    render();
  }
  function saveEdit(seg) {
    const ta = $('.editor-input', el.output);
    applyEdit(seg, ta ? ta.value : state.editDraft);
    state.editingId = null;
    render();
    toast(seg.edited != null ? 'Đã lưu bản sửa.' : 'Không có thay đổi.');
  }

  /* ---------- Hiển thị kết quả ---------- */
  const tool = (act, ic, label) => `<button class="tool" data-act="${act}" title="${label}" aria-label="${label}">${icon(ic)}</button>`;
  function toolsHTML(seg) {
    if (state.editingId === seg.id) return '';
    const st = statusOf(seg);
    let h = '';
    if (st === 'done') h += tool('copy', 'copy', 'Sao chép câu dịch');
    if (st !== 'loading') h += tool('edit', 'edit', st === 'done' ? 'Sửa bản dịch' : 'Tự nhập bản dịch');
    if (st !== 'loading' && !state.busy) h += tool('retry', 'refresh', 'Dịch lại câu này');
    return h;
  }
  function chipHTML(seg) {
    const st = statusOf(seg);
    if (st === 'loading') return '<span class="chip chip-load"><span class="spin"></span>Đang dịch</span>';
    if (st === 'error') return '<span class="chip chip-err">Dịch lỗi</span>';
    if (st === 'offline') return '<span class="chip chip-warn">Chưa có bản dịch</span>';
    if (st === 'pending') return '<span class="chip chip-muted">Chưa dịch</span>';
    let h = '';
    if (seg.edited != null) h += '<span class="chip chip-edit">Đã sửa</span>';
    else if (seg.retried) h += '<span class="chip chip-muted" title="Máy dịch bỏ qua thuật ngữ nên câu được dịch lại để giữ đúng thuật ngữ. Nên đọc lại nghĩa cả câu.">Dịch lại theo thuật ngữ</span>';
    if (seg.warnings.length) h += `<span class="chip chip-warn">${seg.warnings.length} cảnh báo</span>`;
    return h;
  }
  function editorHTML(seg) {
    const t = other(seg.dir);
    return `<div class="editor"><textarea class="editor-input" lang="${LANG[t].html}" rows="2" aria-label="Sửa bản dịch">${esc(state.editDraft)}</textarea>
      <div class="editor-actions"><button class="btn btn-primary btn-sm" data-act="save">${icon('check')}Lưu</button><button class="btn btn-soft btn-sm" data-act="cancel">Hủy</button>${seg.edited != null && seg.machine != null ? '<button class="btn btn-ghost btn-sm" data-act="revert">Khôi phục bản máy</button>' : ''}<span class="editor-hint">Ctrl + Enter để lưu · Esc để hủy</span></div></div>`;
  }
  function targetHTML(seg, short = false) {
    if (state.editingId === seg.id) return editorHTML(seg);
    const st = statusOf(seg);
    if (st === 'loading') return '<div class="skeleton" role="status" aria-label="Đang dịch"><span></span><span></span></div>';
    if (st === 'error') return `<p class="tgt-msg">Dịch lỗi: ${esc(seg.error)}</p>`;
    if (st === 'offline') return `<p class="tgt-msg">${short ? 'Chưa có bản dịch.' : 'Chưa có bản dịch — chế độ mẫu chỉ dịch được câu ví dụ. Hãy kết nối Apps Script hoặc bấm ✎ để tự nhập.'}</p>`;
    if (st === 'pending') return '<p class="tgt-msg">Chưa dịch — bấm “Dịch”.</p>';
    const text = shown(seg);
    const warns = seg.warnings.length ? `<ul class="warns">${seg.warnings.map(w => `<li>${icon('alert')}<span>${esc(w)}</span></li>`).join('')}</ul>` : '';
    return `<p class="tgt-text" lang="${LANG[other(seg.dir)].html}">${tgtMarkup(seg, text)}</p>${warns}`;
  }

  // Chế độ "Gốc + dịch ↓": toàn bộ nguyên văn ở trên, bản dịch liền mạch ở dưới (giữ xuống dòng, đoạn).
  function stackHTML(segs) {
    const s = state.dir, t = other(s);
    const targetPart = seg => {
      const st = statusOf(seg);
      if (st === 'done') return `<span class="tgt-seg">${tgtMarkup(seg, shown(seg))}</span>`;
      if (st === 'loading') return '<span class="seg-wait">…</span>';
      if (st === 'error') return `<span class="seg-err" title="${esc(seg.error)}">[Dịch lỗi]</span>`;
      return '<span class="seg-miss">[Chưa dịch]</span>';
    };
    const allLoading = segs.every(x => statusOf(x) === 'loading');
    const warns = segs.flatMap((seg, i) => seg.warnings.map(w => `<li>${icon('alert')}<span>Câu ${i + 1}: ${esc(w)}</span></li>`));
    const retried = segs.some(x => x.retried && x.edited == null);
    return `<article class="pair whole${warns.length ? ' has-warn' : ''} st-${allLoading ? 'loading' : 'done'}">
        <div class="pair-src"><div class="pair-label">${LANG[s].upper} · NGUYÊN VĂN</div><p class="src-text" lang="${LANG[s].html}">${joinSegs(segs, srcMarkup, s)}</p></div>
        <div class="pair-tgt"><div class="pair-label">${LANG[t].upper} · BẢN DỊCH</div>${allLoading
          ? '<div class="skeleton" role="status" aria-label="Đang dịch"><span></span><span></span></div>'
          : `<p class="tgt-text" lang="${LANG[t].html}">${joinSegs(segs, targetPart, t)}</p>`}
          ${warns.length ? `<ul class="warns">${warns.join('')}</ul>` : ''}
          ${retried ? '<p class="whole-note">Có câu được dịch lại để giữ đúng thuật ngữ — nên đọc lại nghĩa.</p>' : ''}
          <p class="whole-note">Muốn sửa từng câu: chọn <b>Hai cột</b> hoặc <b>Nối tiếp</b>.</p></div>
      </article>`;
  }
  // Ghép các câu theo bố cục gốc (dùng cho hiển thị HTML).
  function joinSegs(segs, part, lang) {
    let out = '', prev = -1;
    segs.forEach((seg, i) => {
      const p = part(seg);
      if (i === 0) out = p;
      else if (seg.para !== prev) out += '\n\n' + p;
      else if (seg.lineStart) out += '\n' + p;
      else out += (lang === 'zh' ? '' : ' ') + p;
      prev = seg.para;
    });
    return out;
  }

  function columnsHTML(segs) {
    const multi = segs.some(x => x.para > 0);
    let rows = '', prev = -1;
    segs.forEach((seg, i) => {
      if (multi && i > 0 && seg.para !== prev) rows += '<div class="cols-gap" aria-hidden="true"></div>';
      prev = seg.para;
      const src = `<p class="src-text" lang="${LANG[seg.dir].html}">${srcMarkup(seg)}</p>`;
      const tgt = targetHTML(seg, true) + (state.editingId === seg.id ? '' : `<div class="cell-tools">${chipHTML(seg)}${toolsHTML(seg)}</div>`);
      const viIsSrc = seg.dir === 'vi';
      rows += `<div class="cols-row st-${statusOf(seg)}${seg.warnings.length ? ' has-warn' : ''}" data-id="${seg.id}" role="row">
        <div class="cols-no" role="cell">${pad2(i + 1)}</div>
        <div class="cell ${viIsSrc ? 'is-src' : 'is-tgt'}" role="cell" data-label="Tiếng Việt · ${viIsSrc ? 'nguyên văn' : 'bản dịch'}">${viIsSrc ? src : tgt}</div>
        <div class="cell ${viIsSrc ? 'is-tgt' : 'is-src'}" role="cell" data-label="中文 · ${viIsSrc ? 'bản dịch' : 'nguyên văn'}">${viIsSrc ? tgt : src}</div>
      </div>`;
    });
    return `<div class="cols" role="table" aria-label="Đối chiếu hai cột"><div class="cols-head" role="row"><div role="columnheader">#</div><div role="columnheader">VI · Tiếng Việt</div><div role="columnheader">中 · 中文</div></div>${rows}</div>`;
  }

  // Chế độ "Nối tiếp": giữ nguyên câu gốc, bản dịch viết liền ngay sau.
  function inlineHTML(segs) {
    const multi = segs.some(x => x.para > 0);
    let html = '', prev = -1;
    segs.forEach((seg, i) => {
      if (multi && seg.para !== prev) html += `<div class="para-sep"><span>Đoạn ${seg.para + 1}</span></div>`;
      prev = seg.para;
      const st = statusOf(seg);
      const src = `<span class="il-src" lang="${LANG[seg.dir].html}">${srcMarkup(seg)}</span>`;
      let body;
      if (state.editingId === seg.id) body = `<p class="il-text">${src}</p>${editorHTML(seg)}`;
      else if (st === 'done') {
        const text = shown(seg);
        const warns = seg.warnings.length ? `<ul class="warns">${seg.warnings.map(w => `<li>${icon('alert')}<span>${esc(w)}</span></li>`).join('')}</ul>` : '';
        body = `<p class="il-text">${src}<span class="il-tgt" lang="${LANG[other(seg.dir)].html}">${tgtMarkup(seg, text)}</span></p>${warns}`;
      } else body = `<p class="il-text">${src}</p>${targetHTML(seg, true)}`;
      html += `<div class="il-row st-${st}${seg.warnings.length ? ' has-warn' : ''}" data-id="${seg.id}">
        <span class="il-no">${pad2(i + 1)}</span><div class="il-body">${body}</div>
        <div class="il-side">${chipHTML(seg)}<span class="pair-tools">${toolsHTML(seg)}</span></div>
      </div>`;
    });
    return `<div class="inline-list">${html}</div>`;
  }
  const inlineText = () => joinByLayout(s => s.original + (shown(s) ?? '[CHƯA DỊCH]'), state.dir);

  function autoGrow(ta) { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 2 + 'px'; }

  function renderOutput() {
    let caret = null;
    const old = $('.editor-input', el.output);
    if (old) {
      state.editDraft = old.value;
      if (document.activeElement === old) caret = [old.selectionStart, old.selectionEnd];
    }
    if (!state.segments.length) {
      el.output.innerHTML = `<div class="empty"><div class="empty-icon">${icon('translate')}</div><strong>Chưa có bản dịch</strong><span>Nhập nội dung rồi bấm <b>Dịch</b> (Ctrl + Enter), hoặc chọn “Nạp ví dụ”.</span></div>`;
      return;
    }
    el.output.innerHTML = state.mode === 'stack' ? stackHTML(state.segments)
      : state.mode === 'inline' ? inlineHTML(state.segments)
      : columnsHTML(state.segments);
    const ta = $('.editor-input', el.output);
    if (ta) {
      autoGrow(ta);
      if (state.focusEditor || caret) {
        ta.focus({ preventScroll: !state.focusEditor });
        const p = caret || [ta.value.length, ta.value.length];
        ta.setSelectionRange(p[0], p[1]);
        state.focusEditor = false;
      }
    }
  }

  function renderSummary() {
    const segs = state.segments;
    if (!segs.length) { el.summary.innerHTML = '<span class="sum-item">Chưa có nội dung</span>'; return; }
    const c = { done: 0, loading: 0, error: 0, offline: 0, pending: 0 };
    let warn = 0, edited = 0;
    segs.forEach(s => { c[statusOf(s)]++; if (s.warnings.length) warn++; if (s.edited != null) edited++; });
    const parts = [`<span class="sum-item"><b>${segs.length}</b> câu</span>`];
    if (state.busy && state.progress) parts.push(`<span class="sum-item sum-load"><span class="spin"></span>Đang dịch ${state.progress.done}/${state.progress.total}</span>`);
    parts.push(`<span class="sum-item sum-ok"><b>${c.done}</b> đã dịch</span>`);
    if (edited) parts.push(`<span class="sum-item"><b>${edited}</b> đã sửa</span>`);
    if (warn) parts.push(`<span class="sum-item sum-warn"><b>${warn}</b> cảnh báo</span>`);
    if (c.error) parts.push(`<span class="sum-item sum-err"><b>${c.error}</b> lỗi</span>`);
    if (c.offline + c.pending) parts.push(`<span class="sum-item"><b>${c.offline + c.pending}</b> chưa dịch</span>`);
    el.summary.innerHTML = parts.join('');
  }

  function renderBanner() {
    const offline = state.segments.some(s => statusOf(s) === 'offline');
    el.banner.innerHTML = !settings.url && offline
      ? `<div class="banner">${icon('info')}<div><b>Đang ở chế độ mẫu.</b> Chỉ các câu ví dụ có bản dịch. Kết nối Google Apps Script (miễn phí) để dịch văn bản bất kỳ.</div><button class="btn btn-soft btn-sm" data-open-settings>Kết nối</button></div>`
      : '';
  }

  function renderLang() {
    const s = state.dir, t = other(s);
    const pill = (d, cap) => `<span class="lp-cap">${cap}</span><span class="lp-main"><span class="lang-badge">${LANG[d].badge}</span>${LANG[d].name}</span>`;
    el.srcPill.innerHTML = pill(s, 'Dịch từ');
    el.tgtPill.innerHTML = pill(t, 'Sang');
    el.srcLangLabel.textContent = LANG[s].name;
    el.input.lang = LANG[s].html;
    el.input.placeholder = s === 'vi' ? 'Nhập hoặc dán nội dung tiếng Việt…' : '输入或粘贴中文内容…（nhập tiếng Trung）';
  }

  function renderModeAndControls() {
    el.modeStack.setAttribute('aria-pressed', String(state.mode === 'stack'));
    el.modeColumns.setAttribute('aria-pressed', String(state.mode === 'columns'));
    el.modeInline.setAttribute('aria-pressed', String(state.mode === 'inline'));
    const s = esc(LANG[state.dir].name), t = esc(LANG[other(state.dir)].name);
    el.modeHelp.innerHTML = state.mode === 'stack'
      ? `Toàn bộ <b>${s}</b> nguyên văn ở trên, <b>${t}</b> bản dịch liền mạch ở dưới.`
      : state.mode === 'inline'
        ? `Giữ nguyên câu <b>${s}</b>, viết liền <b>${t}</b> ngay sau. Nút <b>Song ngữ</b> và <b>TXT</b> xuất đúng dạng nối tiếp này.`
        : 'Đối chiếu theo hàng: <b>Tiếng Việt</b> luôn ở cột trái (trên điện thoại: ở trên), <b>中文</b> luôn ở cột phải.';
    [el.translate, el.swap, el.clear, el.sample].forEach(b => { b.disabled = state.busy; });
    el.translate.innerHTML = state.busy ? '<span class="spin"></span><span>Đang dịch…</span>' : `${icon('translate')}<span>Dịch</span><kbd>Ctrl ↵</kbd>`;
    const has = state.segments.length > 0;
    [el.copyTarget, el.copyBi, el.download].forEach(b => { b.disabled = !has; });
  }

  function render() { renderModeAndControls(); renderSummary(); renderBanner(); renderOutput(); }

  /* ---------- Kết nối & thuật ngữ ---------- */
  const CONN = {
    demo: ['Chế độ mẫu', 'Chưa kết nối Apps Script. Chỉ dịch được câu ví dụ; thuật ngữ là dữ liệu mẫu.'],
    checking: ['Đang kết nối…', 'Đang đọc bảng thuật ngữ từ Google Sheets.'],
    ok: ['Đã kết nối', 'Google Sheets + LanguageApp sẵn sàng.'],
    error: ['Lỗi kết nối', 'Không gọi được Apps Script.']
  };
  function renderConn() {
    const [title, text] = CONN[state.conn];
    $$('[data-conn-dot]').forEach(d => { d.dataset.state = state.conn; });
    $$('[data-conn-title]').forEach(e => { e.textContent = title; });
    $$('[data-conn-text]').forEach(e => { e.textContent = state.connMsg || text; });
  }

  function setGlossary(g) {
    state.glossary = g;
    glossaryVersion++;
    renderGroups();
    renderGlossary();
  }

  function renderGroups() {
    const groups = [...new Set(state.glossary.terms.map(t => t.group).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi'));
    if (!groups.includes(state.gloss.group)) state.gloss.group = '';
    el.groupFilter.innerHTML = '<option value="">Tất cả nhóm</option>' + groups.map(g => `<option>${esc(g)}</option>`).join('');
    el.groupFilter.value = state.gloss.group;
    el.groupFilter.hidden = !groups.length;
  }

  function renderGlossary() {
    const g = state.glossary, terms = g.terms;
    el.navTermCount.textContent = terms.length;
    el.heroTerms.textContent = terms.length;
    const when = g.updatedAt ? new Date(g.updatedAt).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '';
    el.glossSub.textContent =
      g.source === 'demo' ? 'Dữ liệu mẫu — kết nối Apps Script để đọc Google Sheets của bạn (chỉ đọc)'
      : g.source === 'loading' ? 'Đang tải từ Google Sheets…'
      : g.source === 'cache' ? `Bản lưu tạm từ Google Sheets${when ? ' · ' + when : ''} — chưa làm mới được`
      : `Google Sheets${g.sheetName ? ` · tab “${g.sheetName}”` : ''}${when ? ' · cập nhật ' + when : ''} · chỉ đọc`;
    el.reload.hidden = !settings.url;
    el.reload.disabled = state.glossaryLoading;
    el.openSheet.hidden = !g.sheetUrl;
    if (g.sheetUrl) el.openSheet.href = g.sheetUrl;

    const q = fold(state.gloss.q.trim()), grp = state.gloss.group;
    const rows = terms.filter(t => (!grp || t.group === grp) && (!q || fold(`${t.vi} ${t.zh} ${t.group} ${t.note}`).includes(q)));
    el.termInfo.textContent = rows.length === terms.length ? `${terms.length} thuật ngữ` : `${rows.length} / ${terms.length} thuật ngữ`;
    let body;
    if (state.glossaryLoading && !terms.length) body = '<tr><td colspan="4" class="empty-row">Đang tải bảng thuật ngữ…</td></tr>';
    else if (!rows.length) body = `<tr><td colspan="4" class="empty-row">${terms.length ? 'Không tìm thấy thuật ngữ phù hợp.' : 'Bảng thuật ngữ trống.'}</td></tr>`;
    else body = rows.slice(0, state.gloss.limit).map(t => `<tr><td class="t-vi" lang="vi">${esc(t.vi)}</td><td class="t-zh" lang="zh-CN">${esc(t.zh)}</td><td>${t.group ? `<span class="tag">${esc(t.group)}</span>` : '<span class="faint">—</span>'}</td><td class="t-note">${esc(t.note || '')}</td></tr>`).join('');
    el.termBody.innerHTML = body;
    el.more.hidden = rows.length <= state.gloss.limit;
    el.more.textContent = `Hiển thị thêm (còn ${rows.length - state.gloss.limit})`;
  }

  async function loadGlossary(refresh = false) {
    if (!settings.url) {
      state.conn = 'demo'; state.connMsg = '';
      setGlossary({ terms: SAMPLE_TERMS, source: 'demo' });
      renderConn();
      return;
    }
    state.conn = 'checking'; state.connMsg = ''; state.glossaryLoading = true;
    renderConn(); renderGlossary();
    try {
      const d = await api({ action: 'glossary', refresh });
      const terms = (d.terms || [])
        .map(t => ({ vi: nfc(t.vi).trim(), zh: nfc(t.zh).trim(), group: String(t.group || '').trim(), note: String(t.note || '').trim() }))
        .filter(t => t.vi && t.zh);
      const g = { terms, source: 'sheet', sheetName: d.sheetName || '', sheetUrl: d.sheetUrl || '', updatedAt: d.updatedAt || new Date().toISOString() };
      store.set(KEY.glossary, { ...g, url: settings.url });
      state.conn = 'ok';
      state.connMsg = `${terms.length} thuật ngữ từ Google Sheets${g.sheetName ? ` (tab “${g.sheetName}”)` : ''}. Máy dịch: Google LanguageApp.`;
      state.glossaryLoading = false;
      setGlossary(g);
      if (refresh) toast(`Đã tải ${terms.length} thuật ngữ từ Google Sheets.${state.segments.length ? ' Bấm “Dịch” để áp dụng cho văn bản đang mở.' : ''}`, 4000);
    } catch (err) {
      state.conn = 'error'; state.connMsg = err.message; state.glossaryLoading = false;
      const cached = store.get(KEY.glossary, null);
      if (cached && cached.url === settings.url && Array.isArray(cached.terms)) setGlossary({ ...cached, source: 'cache' });
      else setGlossary({ terms: [], source: 'cache' });
      toast('Không đọc được bảng thuật ngữ: ' + err.message, 5000);
    } finally { renderConn(); }
  }

  /* ---------- Sao chép & xuất ---------- */
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
      document.body.append(ta); ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { /* bỏ qua */ }
      ta.remove();
      return ok;
    }
  }
  // Ghép lại theo bố cục gốc: cùng dòng nối liền, xuống dòng giữ nguyên, đoạn cách một dòng trống.
  function joinByLayout(getText, lang) {
    let out = '', prevPara = -1;
    state.segments.forEach((s, i) => {
      const t = getText(s);
      if (i === 0) out = t;
      else if (s.para !== prevPara) out += '\n\n' + t;
      else if (s.lineStart) out += '\n' + t;
      else out += (lang === 'zh' ? '' : ' ') + t;
      prevPara = s.para;
    });
    return out;
  }
  const targetOrMark = s => shown(s) ?? `[CHƯA DỊCH] ${s.original}`;
  function bilingualText() {
    if (state.mode === 'inline') return inlineText();
    const s = state.dir, t = other(s);
    // "Gốc + dịch ↓": cả đoạn nguyên văn, rồi cả đoạn bản dịch.
    if (state.mode === 'stack') return joinByLayout(x => x.original, s) + '\n\n' + joinByLayout(targetOrMark, t);
    let out = '', prev = -1;
    state.segments.forEach((seg, i) => {
      if (i) out += seg.para !== prev ? '\n\n\n' : '\n\n';
      out += `${LANG[s].badge}: ${seg.original}\n${LANG[t].badge}: ${shown(seg) ?? '[CHƯA DỊCH]'}`;
      prev = seg.para;
    });
    return out;
  }
  const missingCount = () => state.segments.filter(s => shown(s) == null).length;

  async function copyOut(kind) {
    commitOpenEditor(); render();
    if (!state.segments.length) return toast('Chưa có bản dịch để sao chép.');
    const text = kind === 'target' ? joinByLayout(targetOrMark, other(state.dir)) : bilingualText();
    const ok = await copyText(text);
    const miss = missingCount();
    toast(!ok ? 'Trình duyệt chặn sao chép tự động.' : `Đã sao chép ${kind === 'target' ? 'bản dịch' : 'bản song ngữ'}.${miss ? ` (${miss} câu chưa dịch được đánh dấu [CHƯA DỊCH])` : ''}`, miss ? 4500 : 2800);
  }

  function downloadTxt() {
    commitOpenEditor(); render();
    if (!state.segments.length) return toast('Chưa có nội dung để tải.');
    const s = state.dir, t = other(s), now = new Date(), line = '='.repeat(44);
    const body = `LinguaTech — Bản dịch song ngữ\n${LANG[s].name} → ${LANG[t].name}\n${now.toLocaleString('vi-VN')}\n${line}\n\n`
      + bilingualText()
      + `\n\n${line}\nBẢN DỊCH LIỀN MẠCH (${LANG[t].name})\n${line}\n\n`
      + joinByLayout(targetOrMark, t) + '\n';
    const blob = new Blob(['﻿' + body.replace(/\n/g, '\r\n')], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ban-dich-${s}-${t}-${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-${pad2(now.getHours())}${pad2(now.getMinutes())}.txt`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Đã tạo file TXT.');
  }

  /* ---------- Ô nhập ---------- */
  const updateCount = () => { el.charCount.textContent = el.input.value.length.toLocaleString('vi-VN'); };
  const saveDraftSoon = debounce(() => { if (settings.saveDraft) store.set(KEY.draft, el.input.value); }, 600);
  function renderDetect() {
    const d = detectLang(el.input.value);
    if (d && d !== state.dir) {
      el.detect.innerHTML = `${icon('alert')}<span>Văn bản có vẻ là <b>${esc(LANG[d].name)}</b>, nhưng chiều dịch đang là ${esc(LANG[state.dir].name)} → ${esc(LANG[other(state.dir)].name)}.</span><button class="btn btn-soft btn-sm" data-detect-swap>Đổi chiều</button>`;
      el.detect.hidden = false;
    } else el.detect.hidden = true;
  }
  const detectSoon = debounce(renderDetect, 350);

  async function swapDir() {
    if (state.busy) return;
    if (state.segments.some(s => s.edited != null) && !(await confirmBox('Đổi chiều sẽ xóa kết quả hiện tại, kể cả các câu đã sửa tay. Văn bản bên trái được giữ nguyên. Tiếp tục?'))) return;
    state.dir = other(state.dir);
    state.segments = [];
    state.editingId = null;
    saveUi();
    renderLang(); render(); renderDetect();
    toast(`Đã đổi chiều: ${LANG[state.dir].name} → ${LANG[other(state.dir)].name}. Văn bản đang soạn được giữ nguyên.`, 3500);
  }

  async function loadSample() {
    const sample = sampleText(state.dir), cur = el.input.value.trim();
    if (cur && cur !== sample.trim() && !(await confirmBox('Thay văn bản đang soạn bằng đoạn ví dụ?', 'Thay bằng ví dụ'))) return;
    el.input.value = sample;
    updateCount(); renderDetect(); saveDraftSoon();
    translateAll(false);
  }

  async function clearAll() {
    if (!el.input.value && !state.segments.length) return;
    if (state.segments.some(s => s.edited != null) && !(await confirmBox('Xóa văn bản và toàn bộ kết quả, kể cả các câu đã sửa tay?', 'Xóa'))) return;
    el.input.value = '';
    state.segments = [];
    state.editingId = null;
    store.del(KEY.draft);
    updateCount(); renderDetect(); render();
    el.input.focus();
  }

  function setMode(m) {
    if (state.mode === m) return;
    commitOpenEditor();
    state.mode = m;
    saveUi();
    render();
  }

  /* ---------- Cài đặt kết nối ---------- */
  function urlProblem(url) {
    if (!url) return '';
    if (!/^https:\/\/script\.google\.com\/(?:a\/[^/]+\/)?macros\/s\/[\w-]+\/(?:exec|dev)\/?$/.test(url)) return 'URL phải có dạng https://script.google.com/macros/s/…/exec';
    if (/\/dev\/?$/.test(url)) return 'Đây là URL /dev (chỉ chủ script dùng được). Hãy dùng URL kết thúc bằng /exec.';
    return '';
  }
  function showTest(kind, msg) { el.testResult.hidden = false; el.testResult.className = 'test-line t-' + kind; el.testResult.textContent = msg; }
  const readForm = () => ({ url: el.urlInput.value.trim(), key: el.keyInput.value.trim() });
  function openSettings() {
    el.urlInput.value = settings.url;
    el.keyInput.value = settings.key;
    el.injectInput.checked = settings.injectTerms;
    el.draftInput.checked = settings.saveDraft;
    el.testResult.hidden = true;
    el.settingsDialog.showModal();
  }

  el.testBtn.addEventListener('click', async () => {
    const conf = readForm(), bad = urlProblem(conf.url);
    if (!conf.url) return showTest('warn', 'Chưa nhập URL.');
    if (bad) return showTest('err', bad);
    showTest('load', 'Đang kiểm tra…');
    el.testBtn.disabled = true;
    try {
      const d = await api({ action: 'glossary', refresh: true }, conf, 45000);
      showTest('ok', `Kết nối tốt · đọc được ${(d.terms || []).length} thuật ngữ từ tab “${d.sheetName || '?'}”.`);
    } catch (err) { showTest('err', err.message); }
    finally { el.testBtn.disabled = false; }
  });

  el.saveSettings.addEventListener('click', () => {
    const conf = readForm(), bad = urlProblem(conf.url);
    if (bad) return showTest('err', bad);
    const changed = conf.url !== settings.url || conf.key !== settings.key;
    Object.assign(settings, conf, { injectTerms: el.injectInput.checked, saveDraft: el.draftInput.checked });
    store.set(KEY.settings, settings);
    if (settings.saveDraft) store.set(KEY.draft, el.input.value); else store.del(KEY.draft);
    el.settingsDialog.close();
    if (changed) {
      state.segments.forEach(s => { if (statusOf(s) === 'offline' || statusOf(s) === 'error') s.status = 'pending'; });
      loadGlossary(true);
    }
    render(); renderConn();
    toast(settings.url ? 'Đã lưu kết nối. Bấm “Dịch” để dịch các câu còn thiếu.' : 'Đã chuyển về chế độ mẫu.', 3500);
  });

  /* ---------- Sự kiện ---------- */
  el.translate.addEventListener('click', () => translateAll(true));
  el.sample.addEventListener('click', loadSample);
  el.clear.addEventListener('click', clearAll);
  el.swap.addEventListener('click', swapDir);
  el.modeStack.addEventListener('click', () => setMode('stack'));
  el.modeColumns.addEventListener('click', () => setMode('columns'));
  el.modeInline.addEventListener('click', () => setMode('inline'));
  el.copyTarget.addEventListener('click', () => copyOut('target'));
  el.copyBi.addEventListener('click', () => copyOut('bilingual'));
  el.download.addEventListener('click', downloadTxt);
  el.input.addEventListener('input', () => { updateCount(); detectSoon(); saveDraftSoon(); });
  el.input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); translateAll(true); }
  });
  el.detect.addEventListener('click', e => { if (e.target.closest('[data-detect-swap]')) swapDir(); });

  el.output.addEventListener('click', async e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const host = btn.closest('[data-id]');
    const seg = host && state.segments.find(s => s.id === host.dataset.id);
    if (!seg) return;
    switch (btn.dataset.act) {
      case 'copy': toast((await copyText(shown(seg))) ? 'Đã sao chép câu dịch.' : 'Trình duyệt chặn sao chép tự động.'); break;
      case 'edit': startEdit(seg); break;
      case 'save': saveEdit(seg); break;
      case 'cancel': state.editingId = null; render(); break;
      case 'revert': seg.edited = null; state.editingId = null; refreshWarnings(seg); render(); toast('Đã khôi phục bản dịch máy.'); break;
      case 'retry': retrySeg(seg); break;
    }
  });
  el.output.addEventListener('keydown', e => {
    if (!e.target.classList.contains('editor-input')) return;
    const seg = state.segments.find(s => s.id === state.editingId);
    if (!seg) return;
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveEdit(seg); }
    else if (e.key === 'Escape') { e.preventDefault(); state.editingId = null; render(); }
  });
  el.output.addEventListener('input', e => { if (e.target.classList.contains('editor-input')) autoGrow(e.target); });

  el.termSearch.addEventListener('input', debounce(() => { state.gloss.q = el.termSearch.value; state.gloss.limit = 150; renderGlossary(); }, 150));
  el.groupFilter.addEventListener('change', () => { state.gloss.group = el.groupFilter.value; state.gloss.limit = 150; renderGlossary(); });
  el.more.addEventListener('click', () => { state.gloss.limit += 300; renderGlossary(); });
  el.reload.addEventListener('click', () => loadGlossary(true));

  document.addEventListener('click', e => {
    if (e.target.closest('[data-open-settings]')) { openSettings(); return; }
    const go = e.target.closest('[data-goto]');
    if (go) {
      const target = document.getElementById(go.dataset.goto);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      $$('[data-goto]').forEach(b => b.classList.toggle('is-active', b.dataset.goto === go.dataset.goto));
    }
    const close = e.target.closest('[data-close]');
    if (close) close.closest('dialog').close();
  });

  /* ---------- Khởi động ---------- */
  function init() {
    renderLang();
    const cached = store.get(KEY.glossary, null);
    if (settings.url && cached && cached.url === settings.url && Array.isArray(cached.terms)) setGlossary({ ...cached, source: 'sheet' });
    else setGlossary({ terms: settings.url ? [] : SAMPLE_TERMS, source: settings.url ? 'loading' : 'demo' });
    const draft = settings.saveDraft ? store.get(KEY.draft, '') : '';
    el.input.value = typeof draft === 'string' && draft.trim() ? draft : sampleText(state.dir);
    updateCount(); renderDetect(); render(); renderConn();
    if (settings.url) loadGlossary(false);
    else translateAll(false);
  }

  window.LinguaTech = { segmentText, findCodes, detectLang, findTerms, getMatcher, injectTerms };
  init();
})();
