// ==UserScript==
// @name         论坛自动刷帖（最终稳定版-修复冲突）
// @namespace    http://tampermonkey.net/
// @version      0.9.1
// @description  修复脚本冲突 | 避免已读 | 可选预览窗口 | UI自定义配置 | 配置与位置记忆 | 精准拖动
// @author       levi & ChatGPT
// @match        https://www.nodeloc.com/*
// @match        https://meta.discourse.org/*
// @grant        GM_setValue
// @grant        GM_getValue
// @license      MIT
// @icon         https://linux.do/uploads/default/original/3X/9/d/9dd49731091ce8656e94433a26a3ef36062b3994.png
// @noframes
// @downloadURL https://update.greasyfork.org/scripts/553171/linuxdo%E4%BF%9D%E6%B4%BB%E4%BC%98%E5%8C%96%E7%89%88%EF%BC%88%E9%AB%98%E6%80%A7%E8%83%BD%E7%89%88%EF%BC%89.user.js
// @updateURL https://update.greasyfork.org/scripts/553171/linuxdo%E4%BF%9D%E6%B4%BB%E4%BC%98%E5%8C%96%E7%89%88%EF%BC%88%E9%AB%98%E6%80%A7%E8%83%BD%E7%89%88%EF%BC%89.meta.js
// ==/UserScript==

(() => {
  'use strict';

  /** ========== 配置 & 状态 ========== **/
  const MAX_HISTORY_SIZE = 1000; // 最大已读历史记录数
  const defaultConfig = {
    scrollInterval: 1200, scrollStep: 800, scrollDuration: 30,
    maxTopics: 100, maxRunMins: 30, showPreview: true,
  };
  let cfg = { ...defaultConfig, ...GM_getValue('linuxdoConfig', {}) };
  let visitedTopics = GM_getValue('linuxdoVisitedTopics', []);

  const log = (t, ...a) => console[t](...a);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const randomWait = (min = 2000, max = 5000) => wait(Math.random() * (max - min) + min);
  const shuffle = arr => arr.sort(() => Math.random() - 0.5);

  let isPaused = false;
  const session = { start: Date.now(), views: 0 };
  const getEnabled = () => GM_getValue('linuxdoEnabled', false);
  const setEnabled = v => GM_setValue('linuxdoEnabled', v);

  let uiState = {
    x: window.innerWidth - 240, y: window.innerHeight - 400,
    minimized: false, ...GM_getValue('linuxdoUiState', {})
  };
  const saveUiState = () => GM_setValue('linuxdoUiState', uiState);
  const saveConfig = () => GM_setValue('linuxdoConfig', cfg);
  const saveVisitedTopics = () => GM_setValue('linuxdoVisitedTopics', visitedTopics);

  /** ========== UI 面板 ========== **/
  function initPanel() {
    if (document.getElementById('ld-panel-container')) return;

    const styles = `
      :root {
        --ld-bg-dark: #2c3e50; --ld-bg-panel: #f7f9fc; --ld-text-light: #ecf0f1;
        --ld-text-dark: #34495e; --ld-primary: #3498db; --ld-success: #2ecc71;
        --ld-danger: #e74c3c; --ld-warning: #f39c12; --ld-border: #e0e0e0;
        --ld-shadow: 0 5px 15px rgba(0,0,0,0.1);
      }
      .ld-common { position: fixed; box-shadow: var(--ld-shadow); z-index: 99999; font-family: "Segoe UI", sans-serif; user-select: none; }
      #ld-panel { width: 220px; border-radius: 12px; background: var(--ld-bg-panel); overflow: hidden; display: ${uiState.minimized ? 'none' : 'block'}; }
      .ld-header { display: flex; justify-content: space-between; align-items: center; cursor: move; background: var(--ld-bg-dark); color: var(--ld-text-light); padding: 8px 12px; font-size: 14px; font-weight: 600; }
      .ld-header-btn { cursor: pointer; font-weight: bold; padding: 0 5px; }
      .ld-body { padding: 12px; font-size: 13px; display: grid; gap: 10px; }
      .ld-body-row { display: flex; justify-content: space-between; align-items: center; }
      .ld-button { width: 100%; padding: 8px; border: none; border-radius: 6px; color: var(--ld-text-light); cursor: pointer; font-weight: 500; transition: all 0.2s ease; }
      .ld-button:active { transform: scale(0.98); }
      #ld-start { background: var(--ld-success); }
      #ld-start.running { background: var(--ld-danger); }
      #ld-pause { background: var(--ld-primary); }
      #ld-pause.paused { background: var(--ld-success); }
      #ld-state { font-weight: bold; }
      #ld-settings { display: none; border-top: 1px solid var(--ld-border); margin-top: 10px; padding-top: 10px; }
      .ld-settings-row { margin-bottom: 8px; }
      .ld-settings-row label { font-size: 12px; color: #555; }
      .ld-settings-row input[type="number"] { width: 100%; box-sizing: border-box; border: 1px solid var(--ld-border); border-radius: 4px; padding: 4px 6px; margin-top: 2px; }
      #ld-ball { width: 60px; height: 60px; border-radius: 50%; background: var(--ld-bg-dark); color: var(--ld-text-light); display: ${uiState.minimized ? 'flex' : 'none'}; align-items: center; justify-content: center; cursor: move; font-size: 28px; transition: transform 0.2s ease; }
      #ld-ball:hover { transform: scale(1.1); }
      .ld-toggle-row { display: flex; align-items: center; justify-content: space-between; }
      .ld-switch { position: relative; display: inline-block; width: 34px; height: 20px; }
      .ld-switch input { opacity: 0; width: 0; height: 0; }
      .ld-slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #ccc; transition: .4s; border-radius: 20px; }
      .ld-slider:before { position: absolute; content: ""; height: 14px; width: 14px; left: 3px; bottom: 3px; background-color: white; transition: .4s; border-radius: 50%; }
      input:checked + .ld-slider { background-color: var(--ld-success); }
      input:checked + .ld-slider:before { transform: translateX(14px); }
      #ld-clear-history { background-color: var(--ld-warning); margin-top: 5px; }
    `;
    document.head.appendChild(Object.assign(document.createElement("style"), { innerText: styles }));

    const container = document.body.appendChild(document.createElement('div'));
    container.id = 'ld-panel-container';
    container.innerHTML = `
      <div id="ld-panel" class="ld-common">
        <div class="ld-header"><span>🧩 论坛助手</span><div><span id="ld-toggle-settings" class="ld-header-btn">⚙️</span><span id="ld-min" class="ld-header-btn">—</span></div></div>
        <div class="ld-body">
          <div class="ld-body-row"><span>🕒 运行时间:</span> <span id="ld-time">0:00</span></div>
          <div class="ld-body-row"><span>👀 本次浏览:</span> <span id="ld-views">0</span></div>
          <div class="ld-body-row"><span>⚙️ 当前状态:</span> <span id="ld-state"></span></div>
          <div id="ld-settings">
            <div class="ld-settings-row"><label for="ld-max-mins">最大运行时长 (分钟)</label><input type="number" id="ld-max-mins" value="${cfg.maxRunMins}"></div>
            <div class="ld-settings-row"><label for="ld-max-topics">最大浏览帖子数</label><input type="number" id="ld-max-topics" value="${cfg.maxTopics}"></div>
            <div class="ld-settings-row ld-toggle-row"><label for="ld-show-preview">显示预览窗口</label><label class="ld-switch"><input type="checkbox" id="ld-show-preview" ${cfg.showPreview ? 'checked' : ''}><span class="ld-slider"></span></label></div>
            <button id="ld-clear-history" class="ld-button">清空已读历史</button>
          </div>
          <button id="ld-start" class="ld-button">▶️ 开始</button>
          <button id="ld-pause" class="ld-button">⏸ 暂停</button>
        </div>
      </div>
      <div id="ld-ball" class="ld-common">🧩</div>
    `;

    const panel = container.querySelector('#ld-panel'), ball = container.querySelector('#ld-ball');
    const els = {
      t: panel.querySelector('#ld-time'), v: panel.querySelector('#ld-views'), s: panel.querySelector('#ld-state'),
      start: panel.querySelector('#ld-start'), pause: panel.querySelector('#ld-pause'),
      settings: panel.querySelector('#ld-settings'), maxMins: panel.querySelector('#ld-max-mins'),
      maxTopics: panel.querySelector('#ld-max-topics'), showPreview: panel.querySelector('#ld-show-preview'),
      clearHistory: panel.querySelector('#ld-clear-history'),
    };

    const setPosition = (el, x, y) => { el.style.left = `${x}px`; el.style.top = `${y}px`; el.style.right = 'auto'; el.style.bottom = 'auto'; };
    setPosition(panel, uiState.x, uiState.y); setPosition(ball, uiState.x, uiState.y);

    const makeDraggable = (handle, target) => {
      handle.onmousedown = e => {
        e.preventDefault();
        let sx = e.clientX, sy = e.clientY, sl = target.offsetLeft, st = target.offsetTop;
        document.onmousemove = ev => { uiState.x = sl + ev.clientX - sx; uiState.y = st + ev.clientY - sy; setPosition(target, uiState.x, uiState.y); };
        document.onmouseup = () => { document.onmousemove = null; document.onmouseup = null; saveUiState(); };
      };
    };
    makeDraggable(panel.querySelector('.ld-header'), panel); makeDraggable(ball, ball);

    panel.querySelector('#ld-min').onclick = () => { uiState.minimized = true; panel.style.display = 'none'; ball.style.display = 'flex'; setPosition(ball, panel.offsetLeft, panel.offsetTop); saveUiState(); };
    ball.onclick = () => { uiState.minimized = false; ball.style.display = 'none'; panel.style.display = 'block'; setPosition(panel, ball.offsetLeft, ball.offsetTop); saveUiState(); };
    panel.querySelector('#ld-toggle-settings').onclick = () => { els.settings.style.display = els.settings.style.display === 'none' ? 'block' : 'none'; };

    els.maxMins.oninput = () => { cfg.maxRunMins = parseInt(els.maxMins.value) || 30; saveConfig(); };
    els.maxTopics.oninput = () => { cfg.maxTopics = parseInt(els.maxTopics.value) || 100; saveConfig(); };
    els.showPreview.onchange = () => { cfg.showPreview = els.showPreview.checked; saveConfig(); };
    els.clearHistory.onclick = () => { visitedTopics = []; saveVisitedTopics(); log('info', '已读历史已清空！'); alert('已读历史已清空！'); };

    els.pause.onclick = () => { if (getEnabled()) { isPaused = !isPaused; log('info', `助手已${isPaused ? '暂停' : '恢复'}`); } };
    els.start.onclick = async () => {
      if (getEnabled()) { setEnabled(false); log('info', '助手已手动停止'); }
      else {
        isPaused = false; session.start = Date.now(); session.views = 0;
        cfg.maxRunMins = parseInt(els.maxMins.value); cfg.maxTopics = parseInt(els.maxTopics.value); cfg.showPreview = els.showPreview.checked;
        setEnabled(true); log('info', '助手已启动，配置：', cfg);
        runMain();
      }
    };

    setInterval(() => {
      const running = getEnabled();
      const st = running ? (isPaused ? '暂停中' : '运行中') : (session.views > 0 ? '已完成' : '停止');
      const clr = running ? (isPaused ? 'var(--ld-warning)' : 'var(--ld-success)') : 'var(--ld-danger)';
      els.s.textContent = st; els.s.style.color = clr;
      els.v.textContent = `${session.views} / ${cfg.maxTopics}`;
      if (running) { const e = Math.floor((Date.now() - session.start) / 1000); els.t.textContent = `${Math.floor(e / 60)}:${(e % 60).toString().padStart(2, '0')}`; }
      els.start.textContent = running ? '🛑 停止' : '▶️ 开始'; els.start.classList.toggle('running', running);
      els.pause.textContent = isPaused ? '▶️ 恢复' : '⏸ 暂停'; els.pause.classList.toggle('paused', isPaused); els.pause.disabled = !running;
    }, 500);
  }

  /** ========== 核心功能 ========== **/
  async function browseTopic(topic) {
    while (isPaused) await wait(1000);
    if (!getEnabled()) return;

    log('info', `正在浏览: ${topic.title}`);
    const iframe = document.body.appendChild(document.createElement('iframe'));

    // ==================== FIX START: 启用沙盒模式并修复预览窗口显示 ====================
    iframe.sandbox = 'allow-scripts allow-same-origin'; // 阻止其他脚本注入，解决冲突
    const visibleStyle = `position: fixed; top: 70px; left: 8px; width: 320px; height: 480px; z-index: 99998; border: 1px solid #ccc; border-radius: 8px; box-shadow: 0 0 8px rgba(0,0,0,0.2); background: white;`;
    const hiddenStyle = `position:fixed; top:-9999px; left:-9999px; opacity:0;`;
    iframe.style.cssText = cfg.showPreview ? visibleStyle : hiddenStyle;
    // ===================== FIX END =====================

    iframe.src = `${topic.url}?_=${Date.now()}`;

    try {
      await Promise.race([new Promise(r => (iframe.onload = r)), wait(10000)]);
      session.views++;

      if (!visitedTopics.includes(topic.url)) {
        visitedTopics.push(topic.url);
        if (visitedTopics.length > MAX_HISTORY_SIZE) visitedTopics.shift();
        saveVisitedTopics();
      }

      const endTime = Date.now() + cfg.scrollDuration * 1000;
      while (Date.now() < endTime && getEnabled()) {
        if (isPaused) { await wait(1000); continue; }
        if (iframe.contentWindow) iframe.contentWindow.scrollBy(0, cfg.scrollStep);
        await wait(cfg.scrollInterval);
      }
    } catch (e) { log('error', '浏览帖子时发生错误', e); }
    finally { iframe.remove(); await randomWait(); }
  }

  const shouldStop = () => {
    if (!getEnabled()) { log('info', '任务已停止。'); return true; }
    if (session.views >= cfg.maxTopics) { log('info', `已达到最大浏览数 (${cfg.maxTopics})。`); return true; }
    if ((Date.now() - session.start) / 60000 >= cfg.maxRunMins) { log('info', `已达到最大运行时长 (${cfg.maxRunMins}分钟)。`); return true; }
    return false;
  };

  /** ========== 主循环 ========== **/
  async function runMain() {
    const allTopics = await (async () => [...document.querySelectorAll('#list-area a.title')].filter(el => !el.closest('tr')?.querySelector('.pinned')).map(el => ({ title: el.textContent.trim(), url: el.href })))();

    const unreadTopics = allTopics.filter(t => !visitedTopics.includes(t.url));
    log('info', `获取到 ${allTopics.length} 个帖子，其中 ${unreadTopics.length} 个是未读的。`);

    const topicsToBrowse = shuffle(unreadTopics);
    if (topicsToBrowse.length === 0) {
        log('info', '当前页面没有未读的帖子。');
    }

    for (const topic of topicsToBrowse) {
      if (shouldStop()) break;
      await browseTopic(topic);
    }

    if (getEnabled()) { log('info', '任务完成。'); setEnabled(false); }
  }

  /** ========== 启动入口 ========== **/
  window.addEventListener('load', initPanel);

})();
