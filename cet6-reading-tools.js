/*
 * CET-6 Reading Tools
 * 功能：英文段落悬浮即时翻译、选中文本操作菜单、重点标记、个人笔记本。
 * 接入方式：在原 index.html 的原有主脚本结束后、</body> 之前加入：
 * <script src="./cet6-reading-tools.js"></script>
 * 依赖：原网站已有的全局 state / save / toast / go 函数。
 */
(function (getState, saveAppState, showToast, goPage) {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const state = getState();
  if (!Array.isArray(state.notebook)) state.notebook = [];
  if (!Array.isArray(state.highlights)) state.highlights = [];

  const translationCache = new Map();
  let hoverTimer = null;
  let lastHoverText = '';
  let pendingSelection = null;
  let translationRequestId = 0;

  const css = `
  #cet6-translation-tooltip{position:fixed;z-index:10020;display:none;width:min(420px,calc(100vw - 24px));max-height:45vh;overflow:auto;padding:14px 16px;border:1px solid rgba(173,202,245,.30);border-radius:15px;background:rgba(15,24,42,.96);box-shadow:0 16px 48px rgba(0,0,0,.48);backdrop-filter:blur(20px);color:#edf3ff;pointer-events:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif}
  #cet6-translation-tooltip.show{display:block}
  #cet6-translation-tooltip .cet6-tip-label{font-size:10px;letter-spacing:.08em;color:#91bce9;margin-bottom:7px;text-transform:uppercase}
  #cet6-translation-tooltip .cet6-tip-en{font:13px/1.6 Georgia,"Times New Roman",serif;color:#c5d4e9;padding-bottom:7px;border-bottom:1px solid rgba(255,255,255,.10);margin-bottom:8px}
  #cet6-translation-tooltip .cet6-tip-zh{font-size:14px;line-height:1.7;color:#fff}
  #cet6-translation-tooltip .cet6-tip-foot{font-size:10px;color:#8294ae;margin-top:8px}
  #cet6-selection-menu{position:fixed;z-index:10030;display:none;min-width:230px;padding:9px;border:1px solid rgba(180,205,245,.25);border-radius:14px;background:rgba(18,27,44,.97);box-shadow:0 16px 45px rgba(0,0,0,.45);backdrop-filter:blur(18px);color:#eef4ff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif}
  #cet6-selection-menu.show{display:block}
  .cet6-menu-caption{font-size:10px;color:#91a4bf;padding:2px 6px 7px;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .cet6-menu-actions{display:flex;gap:6px;flex-wrap:wrap}
  .cet6-menu-btn{border:1px solid rgba(255,255,255,.13);border-radius:9px;background:rgba(255,255,255,.07);color:#eaf2ff;padding:8px 10px;font-size:12px;cursor:pointer;transition:.15s}
  .cet6-menu-btn:hover{background:rgba(105,163,230,.22);border-color:rgba(132,197,255,.4)}
  .cet6-menu-btn.primary{background:rgba(85,147,220,.24);border-color:rgba(132,197,255,.4)}
  .cet6-user-highlight{background:rgba(255,190,92,.20);color:inherit;border-bottom:2px solid #e5a34c;border-radius:2px;padding:0 1px;box-decoration-break:clone;-webkit-box-decoration-break:clone}
  #page-notebook .cet6-notebook-toolbar{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px}
  #page-notebook .cet6-notebook-card{padding:17px 18px;margin-bottom:12px;border:1px solid rgba(255,255,255,.12);border-radius:16px;background:rgba(255,255,255,.045)}
  #page-notebook .cet6-note-meta{font-size:11px;color:#8ea1bd;margin-bottom:9px}
  #page-notebook .cet6-note-quote{font:17px/1.7 Georgia,"Times New Roman",serif;color:#e9f1ff;margin:0 0 10px;white-space:pre-wrap;overflow-wrap:anywhere}
  #page-notebook .cet6-note-translation{font-size:13px;line-height:1.75;color:#b9c9df;white-space:pre-wrap;overflow-wrap:anywhere;border-left:2px solid rgba(132,197,255,.55);padding-left:11px;margin:9px 0 12px}
  #page-notebook .cet6-note-actions{display:flex;gap:7px;flex-wrap:wrap}
  #page-notebook .cet6-note-empty{padding:30px 18px;text-align:center;color:#9aa9c1;border:1px dashed rgba(255,255,255,.18);border-radius:15px;line-height:1.8}
  #page-notebook .cet6-notice{font-size:11px;line-height:1.7;color:#91a1b8;margin-top:12px}
  @media(max-width:600px){#cet6-selection-menu{min-width:210px}.cet6-menu-btn{font-size:11px;padding:8px}#page-notebook .cet6-notebook-card{padding:14px}}
  `;
  const style = document.createElement('style');
  style.id = 'cet6-reading-tools-style';
  style.textContent = css;
  document.head.appendChild(style);

  const tooltip = document.createElement('div');
  tooltip.id = 'cet6-translation-tooltip';
  tooltip.setAttribute('role', 'status');
  tooltip.setAttribute('aria-live', 'polite');
  document.body.appendChild(tooltip);

  const menu = document.createElement('div');
  menu.id = 'cet6-selection-menu';
  menu.innerHTML = `
    <div class="cet6-menu-caption" id="cet6-menu-caption">已选中英文</div>
    <div class="cet6-menu-actions">
      <button type="button" class="cet6-menu-btn" data-cet6-action="translate">译 · 翻译</button>
      <button type="button" class="cet6-menu-btn" data-cet6-action="highlight">✦ 标记重点</button>
      <button type="button" class="cet6-menu-btn primary" data-cet6-action="save">＋ 加入笔记本</button>
    </div>`;
  document.body.appendChild(menu);
  menu.addEventListener('mousedown', (e) => e.preventDefault());

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function currentState() {
    const s = getState();
    if (!Array.isArray(s.notebook)) s.notebook = [];
    if (!Array.isArray(s.highlights)) s.highlights = [];
    return s;
  }

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function isEnglish(value) {
    const text = normalizeText(value);
    return /[A-Za-z]{2,}/.test(text) && (text.match(/[A-Za-z]/g) || []).length >= 5;
  }

  function pageId() {
    const active = document.querySelector('.page.active');
    return active ? active.id.replace(/^page-/, '') : 'reading';
  }

  function getReadingContext(node) {
    let el = node && node.nodeType === Node.ELEMENT_NODE ? node : node && node.parentElement;
    if (!el) return null;
    if (el.closest('a,button,input,textarea,select,script,style,.vocab-mark,#cet6-selection-menu,#cet6-translation-tooltip')) return null;
    const block = el.closest('p,h1,h2,h3,h4,li,.en,.lead');
    if (!block) return null;
    const root = block.closest('#articleBody,#grammarContent,.journal-page,.reader-summary,.article');
    if (!root) return null;
    return { block, root };
  }

  function getRootKey(root) {
    const s = currentState();
    if (root.id === 'articleBody') return `lesson:${s.day}:article`;
    if (root.id === 'grammarContent') return `lesson:${s.day}:grammar`;
    if (root.classList.contains('journal-page')) return 'journal';
    return `${pageId()}:${root.id || root.className || 'reading'}`;
  }

  function getSourceInfo(root) {
    const key = getRootKey(root);
    const s = currentState();
    if (key.startsWith('lesson:')) {
      const day = Number(key.split(':')[1]) || s.day;
      const title = $('lessonTitle')?.textContent?.trim() || '';
      return { key, title: `今日文章 · Day ${day}${title ? ' · ' + title : ''}`, day };
    }
    if (key === 'journal') {
      const title = $('journalLeadTitle')?.textContent?.trim() || '每日英文期刊';
      return { key, title: `每日英文期刊 · ${title}`, day: null };
    }
    return { key, title: pageId() === 'lesson' ? `今日文章 · Day ${s.day}` : '英文阅读摘录', day: s.day };
  }

  function blocksIn(root) {
    return Array.from(root.querySelectorAll('p,h1,h2,h3,h4,li,.en,.lead'));
  }

  function sentenceAtPointer(block, x, y) {
    const text = (block.innerText || block.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    let offset = 0;
    try {
      let r = null;
      if (document.caretRangeFromPoint) r = document.caretRangeFromPoint(x, y);
      else if (document.caretPositionFromPoint) {
        const p = document.caretPositionFromPoint(x, y);
        if (p) { r = document.createRange(); r.setStart(p.offsetNode, p.offset); r.collapse(true); }
      }
      if (r && block.contains(r.startContainer)) {
        const pre = document.createRange();
        pre.selectNodeContents(block);
        pre.setEnd(r.startContainer, r.startOffset);
        offset = pre.toString().length;
      }
    } catch (_) { /* 某些浏览器不支持按坐标取词，改为翻译整段 */ }

    const matches = Array.from(text.matchAll(/[^.!?。！？]+(?:[.!?。！？]+[”’'"）)]*)?/g));
    let selected = matches.find((m) => offset >= m.index && offset <= m.index + m[0].length)?.[0] || text;
    selected = normalizeText(selected);
    if (selected.length > 420) {
      const start = Math.max(0, Math.min(selected.length - 380, offset - 180));
      selected = selected.slice(start, start + 380).replace(/^\S*\s/, '').replace(/\s\S*$/, '');
    }
    return selected;
  }

  function placeFloating(el, rect, preferAbove) {
    const width = el.offsetWidth || 360;
    const height = el.offsetHeight || 100;
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
    let top = preferAbove ? rect.top - height - 10 : rect.bottom + 10;
    if (top + height > window.innerHeight - 10) top = rect.top - height - 10;
    if (top < 10) top = Math.min(window.innerHeight - height - 10, rect.bottom + 10);
    el.style.left = `${left}px`;
    el.style.top = `${Math.max(10, top)}px`;
  }

  function showTooltip(text, translation, rect, loading) {
    tooltip.innerHTML = `
      <div class="cet6-tip-label">${loading ? '正在翻译 · EN → 中文' : '即时翻译 · EN → 中文'}</div>
      <div class="cet6-tip-en">${esc(text)}</div>
      <div class="cet6-tip-zh">${loading ? '正在获取译文……' : esc(translation || '暂时没有获取到译文。')}</div>
      <div class="cet6-tip-foot">自动翻译仅供阅读参考 · 由 MyMemory 提供</div>`;
    tooltip.classList.add('show');
    placeFloating(tooltip, rect, false);
  }

  function hideTooltip() {
    tooltip.classList.remove('show');
  }

  async function translateText(text) {
    const query = normalizeText(text).slice(0, 430);
    if (!query) throw new Error('没有可翻译的英文内容');
    if (translationCache.has(query)) return translationCache.get(query);
    const params = new URLSearchParams({ q: query, langpair: 'en|zh-CN' });
    const response = await fetch(`https://api.mymemory.translated.net/get?${params.toString()}`, {
      method: 'GET', headers: { Accept: 'application/json' }
    });
    if (!response.ok) throw new Error(`翻译服务响应异常（${response.status}）`);
    const data = await response.json();
    if (Number(data.responseStatus) !== 200 || !data.responseData?.translatedText) {
      throw new Error(data.responseDetails || '翻译服务暂时没有返回结果');
    }
    const result = String(data.responseData.translatedText).trim();
    translationCache.set(query, result);
    return result;
  }

  async function translateAndShow(text, rect) {
    const requestId = ++translationRequestId;
    showTooltip(text, '', rect, true);
    try {
      const result = await translateText(text);
      if (requestId !== translationRequestId) return result;
      showTooltip(text, result, rect, false);
      return result;
    } catch (error) {
      if (requestId === translationRequestId) {
        showTooltip(text, `翻译暂不可用：${error.message}。请检查网络，或稍后再试。`, rect, false);
      }
      throw error;
    }
  }

  // 鼠标停留在本站英文阅读区的句子上约 650ms 后自动请求译文。
  document.addEventListener('pointermove', (event) => {
    const context = getReadingContext(event.target);
    if (!context || event.target.closest('.vocab-mark')) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
      lastHoverText = '';
      hideTooltip();
      return;
    }
    const sentence = sentenceAtPointer(context.block, event.clientX, event.clientY);
    if (!isEnglish(sentence)) return;
    if (sentence === lastHoverText) return;
    lastHoverText = sentence;
    clearTimeout(hoverTimer);
    const rect = context.block.getBoundingClientRect();
    hoverTimer = setTimeout(() => {
      translateAndShow(sentence, rect).catch(() => {});
    }, 650);
  }, { passive: true });

  document.addEventListener('scroll', () => {
    clearTimeout(hoverTimer);
    hoverTimer = null;
    lastHoverText = '';
    hideTooltip();
    hideSelectionMenu();
  }, true);

  function hideSelectionMenu() {
    menu.classList.remove('show');
    pendingSelection = null;
  }

  function showSelectionMenu(selection, range, context) {
    const quote = normalizeText(selection);
    if (!quote || !isEnglish(quote)) return;
    const rect = range.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) return;
    const rawText = range.toString().trim();
    const blocks = blocksIn(context.root);
    pendingSelection = {
      text: quote,
      rawText,
      range: range.cloneRange(),
      blockIndex: blocks.indexOf(context.block),
      source: getSourceInfo(context.root)
    };
    $('cet6-menu-caption').textContent = `已选中 ${quote.length} 个字符`;
    menu.classList.add('show');
    placeFloating(menu, rect, true);
  }

  document.addEventListener('mouseup', (event) => {
    if (event.target.closest('#cet6-selection-menu')) return;
    window.setTimeout(() => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount) {
        hideSelectionMenu();
        return;
      }
      const range = selection.getRangeAt(0);
      const context = getReadingContext(range.commonAncestorContainer);
      if (!context || !context.block.contains(range.startContainer) || !context.block.contains(range.endContainer)) {
        hideSelectionMenu();
        return;
      }
      const quote = normalizeText(selection.toString());
      if (quote.length < 2 || quote.length > 430 || !isEnglish(quote)) {
        hideSelectionMenu();
        return;
      }
      showSelectionMenu(selection.toString(), range, context);
    }, 0);
  });

  function makeId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  }

  function wrapRange(range, id) {
    if (!range || range.collapsed) return false;
    const mark = document.createElement('mark');
    mark.className = 'cet6-user-highlight';
    mark.dataset.cet6Highlight = id;
    try {
      range.surroundContents(mark);
    } catch (_) {
      try {
        const fragment = range.extractContents();
        mark.appendChild(fragment);
        range.insertNode(mark);
      } catch (__) {
        return false;
      }
    }
    return true;
  }

  function markSelectedText() {
    if (!pendingSelection) return;
    const item = pendingSelection;
    const s = currentState();
    const duplicate = s.highlights.some((h) => h.sourceKey === item.source.key && h.text === item.text);
    if (duplicate) {
      showToast('这段内容已经标记过了');
      hideSelectionMenu();
      return;
    }
    const id = makeId('hl');
    const record = {
      id,
      text: item.text,
      rawText: item.rawText,
      sourceKey: item.source.key,
      source: item.source.title,
      blockIndex: item.blockIndex,
      createdAt: new Date().toISOString()
    };
    s.highlights.unshift(record);
    const ok = wrapRange(item.range.cloneRange(), id);
    saveAppState();
    window.getSelection()?.removeAllRanges();
    hideSelectionMenu();
    showToast(ok ? '已标记重点，可在笔记本中查看' : '重点已记录；当前页面未能直接着色');
  }

  async function addNotebookNote() {
    if (!pendingSelection) return;
    const item = pendingSelection;
    const s = currentState();
    const duplicate = s.notebook.find((n) => n.sourceKey === item.source.key && n.text === item.text);
    if (duplicate) {
      hideSelectionMenu();
      showToast('笔记本中已经有这段内容了');
      goPage('notebook');
      renderNotebook();
      return;
    }
    const note = {
      id: makeId('note'),
      text: item.text,
      rawText: item.rawText,
      translation: '',
      sourceKey: item.source.key,
      source: item.source.title,
      blockIndex: item.blockIndex,
      createdAt: new Date().toISOString()
    };
    s.notebook.unshift(note);
    saveAppState();
    window.getSelection()?.removeAllRanges();
    hideSelectionMenu();
    showToast('已加入笔记本，正在生成中文译文');
    goPage('notebook');
    renderNotebook();
    try {
      note.translation = await translateText(note.text);
    } catch (error) {
      note.translation = `自动翻译暂不可用：${error.message}。可在笔记本中点击“重新翻译”。`;
    }
    saveAppState();
    if (pageId() === 'notebook') renderNotebook();
  }

  menu.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-cet6-action]');
    if (!button || !pendingSelection) return;
    const action = button.dataset.cet6Action;
    const item = pendingSelection;
    if (action === 'highlight') {
      markSelectedText();
    } else if (action === 'save') {
      await addNotebookNote();
    } else if (action === 'translate') {
      const rect = item.range.getBoundingClientRect();
      hideSelectionMenu();
      translateAndShow(item.text, rect).catch(() => {});
    }
  });

  function locateTextRange(root, query) {
    if (!root || !query) return null;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (parent && parent.closest('script,style,button,.cet6-user-highlight')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const parts = [];
    let fullText = '';
    let node;
    while ((node = walker.nextNode())) {
      const value = node.nodeValue;
      parts.push({ node, start: fullText.length, end: fullText.length + value.length });
      fullText += value;
    }
    const startIndex = fullText.indexOf(query);
    if (startIndex < 0) return null;
    const endIndex = startIndex + query.length;
    const startPart = parts.find((p) => startIndex >= p.start && startIndex <= p.end);
    const endPart = parts.find((p) => endIndex >= p.start && endIndex <= p.end);
    if (!startPart || !endPart) return null;
    const range = document.createRange();
    range.setStart(startPart.node, startIndex - startPart.start);
    range.setEnd(endPart.node, endIndex - endPart.start);
    return range;
  }

  function rootForKey(key) {
    if (key === 'journal') return document.querySelector('.journal-page');
    if (key.startsWith('lesson:')) {
      const type = key.split(':')[2];
      return type === 'grammar' ? $('grammarContent') : $('articleBody');
    }
    const bits = key.split(':');
    return bits.length > 1 ? $(bits[1]) : null;
  }

  function applySavedHighlights(root, key) {
    if (!root) return;
    const s = currentState();
    const list = s.highlights.filter((h) => h.sourceKey === key);
    list.forEach((h) => {
      if (root.querySelector(`[data-cet6-highlight="${h.id}"]`)) return;
      const blocks = blocksIn(root);
      const block = blocks[h.blockIndex];
      if (!block) return;
      const range = locateTextRange(block, h.rawText || h.text);
      if (range) wrapRange(range, h.id);
    });
  }

  function applyAllSavedHighlights() {
    const s = currentState();
    applySavedHighlights($('articleBody'), `lesson:${s.day}:article`);
    applySavedHighlights($('grammarContent'), `lesson:${s.day}:grammar`);
    applySavedHighlights(document.querySelector('.journal-page'), 'journal');
  }

  const articleRoot = $('articleBody');
  const grammarRoot = $('grammarContent');
  const journalRoot = document.querySelector('.journal-page');
  [articleRoot, grammarRoot, journalRoot].filter(Boolean).forEach((root) => {
    const observer = new MutationObserver(() => {
      window.requestAnimationFrame(applyAllSavedHighlights);
    });
    observer.observe(root, { childList: true, subtree: true });
  });
  window.setTimeout(applyAllSavedHighlights, 0);

  function formatDate(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  function renderNotebook() {
    const s = currentState();
    const list = $('cet6NotebookList');
    const count = $('cet6NotebookCount');
    const highlightCount = $('cet6HighlightCount');
    if (!list) return;
    count.textContent = `${s.notebook.length} 条笔记`;
    highlightCount.textContent = `${s.highlights.length} 处重点`;
    if (!s.notebook.length && !s.highlights.length) {
      list.innerHTML = `<div class="cet6-note-empty">你的笔记本还是空的。<br>在英文文章中选中不熟悉的句子，就能翻译、标记重点或收录到这里。</div>`;
      return;
    }
    const notesHTML = s.notebook.map((n) => `
      <article class="cet6-notebook-card" data-note-id="${esc(n.id)}">
        <div class="cet6-note-meta">${esc(n.source || '英文阅读摘录')} · ${esc(formatDate(n.createdAt))}</div>
        <p class="cet6-note-quote">${esc(n.text)}</p>
        <div class="cet6-note-translation">${esc(n.translation || '译文生成中……')}</div>
        <div class="cet6-note-actions">
          <button class="btn small" data-note-action="copy">复制英文</button>
          <button class="btn small" data-note-action="retry">重新翻译</button>
          <button class="btn small" data-note-action="locate">返回原文</button>
          <button class="btn small danger" data-note-action="delete">删除笔记</button>
        </div>
      </article>`).join('');
    const highlightsHTML = s.highlights.length ? `
      <div class="sectionhead"><h2>重点标记</h2><p>在阅读页面中以金色底纹显示</p></div>
      ${s.highlights.map((h) => `
      <article class="cet6-notebook-card" data-highlight-id="${esc(h.id)}">
        <div class="cet6-note-meta">${esc(h.source || '英文阅读摘录')} · ${esc(formatDate(h.createdAt))}</div>
        <p class="cet6-note-quote">${esc(h.text)}</p>
        <div class="cet6-note-actions"><button class="btn small" data-highlight-action="locate">返回原文</button><button class="btn small danger" data-highlight-action="delete">取消标记</button></div>
      </article>`).join('')}` : '';
    list.innerHTML = notesHTML + highlightsHTML;
  }

  function returnToSource(item) {
    const key = item.sourceKey || '';
    if (key.startsWith('lesson:')) {
      const day = Number(key.split(':')[1]);
      if (day >= 1 && day <= 30) currentState().day = day;
      saveAppState();
      goPage(key.endsWith(':grammar') ? 'lesson' : 'lesson');
      window.setTimeout(() => {
        const root = rootForKey(key);
        const block = root && blocksIn(root)[item.blockIndex];
        block?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 180);
    } else if (key === 'journal') {
      goPage('journal');
      window.setTimeout(() => {
        const root = rootForKey(key);
        const block = root && blocksIn(root)[item.blockIndex];
        block?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 180);
    } else {
      showToast('已保存摘录；原文所在页面可能已更新');
    }
  }

  $('cet6NotebookList').addEventListener('click', async (event) => {
    const noteCard = event.target.closest('[data-note-id]');
    const noteButton = event.target.closest('[data-note-action]');
    const highlightCard = event.target.closest('[data-highlight-id]');
    const highlightButton = event.target.closest('[data-highlight-action]');
    const s = currentState();
    if (noteCard && noteButton) {
      const note = s.notebook.find((n) => n.id === noteCard.dataset.noteId);
      if (!note) return;
      const action = noteButton.dataset.noteAction;
      if (action === 'delete') {
        s.notebook = s.notebook.filter((n) => n.id !== note.id);
        saveAppState(); renderNotebook(); showToast('笔记已删除');
      } else if (action === 'copy') {
        try { await navigator.clipboard.writeText(note.text); showToast('英文摘录已复制'); }
        catch (_) { window.prompt('复制下面的英文：', note.text); }
      } else if (action === 'retry') {
        note.translation = '正在重新翻译……'; renderNotebook();
        try { note.translation = await translateText(note.text); }
        catch (error) { note.translation = `翻译暂不可用：${error.message}`; }
        saveAppState(); renderNotebook();
      } else if (action === 'locate') {
        returnToSource(note);
      }
    }
    if (highlightCard && highlightButton) {
      const item = s.highlights.find((h) => h.id === highlightCard.dataset.highlightId);
      if (!item) return;
      const action = highlightButton.dataset.highlightAction;
      if (action === 'delete') {
        s.highlights = s.highlights.filter((h) => h.id !== item.id);
        document.querySelectorAll(`[data-cet6-highlight="${item.id}"]`).forEach((mark) => {
          const parent = mark.parentNode;
          while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
          parent.removeChild(mark);
          parent.normalize();
        });
        saveAppState(); renderNotebook(); showToast('已取消重点标记');
      } else if (action === 'locate') {
        returnToSource(item);
      }
    }
  });

  function addNotebookPage() {
    const nav = document.querySelector('.nav');
    const content = document.querySelector('main.content');
    if (!nav || !content) return;
    if (!document.querySelector('[data-page="notebook"]')) {
      const btn = document.createElement('button');
      btn.dataset.page = 'notebook';
      btn.innerHTML = '<span class="ico">✎</span>我的笔记本';
      nav.appendChild(btn);
      btn.addEventListener('click', () => {
        goPage('notebook');
        renderNotebook();
      });
    }
    if (!$('page-notebook')) {
      const section = document.createElement('section');
      section.className = 'page';
      section.id = 'page-notebook';
      section.innerHTML = `
        <div class="hero glass">
          <div class="eyebrow">PERSONAL ENGLISH NOTEBOOK</div>
          <h2>我的英文笔记本</h2>
          <p>把阅读中不确定的词句收集起来。每条摘录都保留英文原文、自动中文翻译和来源位置，方便反复回顾。</p>
          <div class="cet6-notebook-toolbar"><div><span class="pill" id="cet6NotebookCount">0 条笔记</span> <span class="pill" id="cet6HighlightCount">0 处重点</span></div><button class="btn small" id="cet6NotebookRefresh">↻ 刷新</button></div>
          <div class="cet6-notice">翻译需要联网，并通过第三方翻译服务处理你悬浮或选中的英文内容。自动译文仅供理解参考；外部期刊原文页面不在本站悬浮翻译范围内。</div>
        </div>
        <div class="sectionhead"><h2>收录的英文摘录</h2><p>选中句子后点击“加入笔记本”即可收录</p></div>
        <div id="cet6NotebookList"></div>`;
      content.appendChild(section);
      $('cet6NotebookRefresh').addEventListener('click', renderNotebook);
    }
  }

  // 原网站的“清空学习进度”只应清除课程/复习数据，不应顺带删除个人摘录。
  const resetButton = $('resetProgress');
  if (resetButton) {
    resetButton.addEventListener('click', () => {
      const before = currentState();
      const savedNotes = before.notebook.slice();
      const savedHighlights = before.highlights.slice();
      window.setTimeout(() => {
        const after = currentState();
        if (!after.notebook.length && savedNotes.length) after.notebook = savedNotes;
        if (!after.highlights.length && savedHighlights.length) after.highlights = savedHighlights;
        saveAppState();
        renderNotebook();
      }, 0);
    }, true);
  }

  addNotebookPage();
  renderNotebook();

  // 在页面内容重新渲染后恢复此前的重点标记。
  const pageObserver = new MutationObserver(() => {
    if (pageObserver._queued) return;
    pageObserver._queued = true;
    window.setTimeout(() => {
      pageObserver._queued = false;
      applyAllSavedHighlights();
    }, 80);
  });
  const contentRoot = document.querySelector('main.content');
  if (contentRoot) pageObserver.observe(contentRoot, { childList: true, subtree: true });

  // 重新进入笔记本页时刷新数量与内容。
  document.addEventListener('click', (event) => {
    const navButton = event.target.closest('.nav button[data-page="notebook"]');
    if (navButton) window.setTimeout(renderNotebook, 0);
  });

  // 若翻译提示已显示但用户点击页面，收起提示，不影响原有单词词典。
  document.addEventListener('click', (event) => {
    if (!event.target.closest('#cet6-translation-tooltip,#cet6-selection-menu')) hideTooltip();
  });

})(() => state, save, toast, go);
