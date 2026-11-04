// Frontend Application Controller for cursor-zh
(function () {
  'use strict';

  let currentStatus = null;
  let isOperating = false;
  let operationLogs = [];
  let currentLanguage = 'zh-cn';
  const traditional = window.cursorZhTraditional;
  const traditionalPattern = new RegExp(Object.keys(traditional).sort((left, right) => right.length - left.length).join('|'), 'g');
  const staticLabels = [];

  function translate(text) {
    return currentLanguage === 'zh-tw' ? text.replace(traditionalPattern, source => traditional[source]) : text;
  }

  function renderLanguage(locale) {
    currentLanguage = locale;
    for (const input of elLanguageSelect.querySelectorAll('input')) {
      input.checked = input.value === locale;
    }
    elLanguageSelect.setAttribute('aria-label', translate('汉化语言'));
    document.documentElement.lang = locale === 'zh-tw' ? 'zh-TW' : 'zh-CN';
    for (const label of staticLabels) {
      if (label.node.isConnected) label.node.textContent = translate(label.source);
    }
  }

  // DOM Elements
  const elAppVersionBadge = document.getElementById('appVersionBadge');
  const elBtnAbout = document.getElementById('btnAbout');
  const elCursorVersion = document.getElementById('cursorVersion');
  const elCursorPathDisplay = document.getElementById('cursorPathDisplay');
  const elBtnChangePath = document.getElementById('btnChangePath');
  const elStatusPill = document.getElementById('statusPill');
  const elStatusCard = document.getElementById('statusCard');
  const elStatusLabel = document.getElementById('statusLabel');
  const elStatusDesc = document.getElementById('statusDesc');
  const elProgressBox = document.getElementById('progressBox');
  const elProgressStage = document.getElementById('progressStage');
  const elProgressDetail = document.getElementById('progressDetail');
  const elBtnPrimaryAction = document.getElementById('btnPrimaryAction');
  const elBtnSecondaryAction = document.getElementById('btnSecondaryAction');
  const elBtnRestore = document.getElementById('btnRestore');
  const elUpdateText = document.getElementById('updateText');
  const elBtnUpdateAction = document.getElementById('btnUpdateAction');
  const elBtnToggleLogs = document.getElementById('btnToggleLogs');
  const elLogDrawer = document.getElementById('logDrawer');
  const elLogContent = document.getElementById('logContent');
  const elBtnCopyLogs = document.getElementById('btnCopyLogs');
  const elBtnCloseLogs = document.getElementById('btnCloseLogs');
  const elAboutModal = document.getElementById('aboutModal');
  const elBtnCloseAbout = document.getElementById('btnCloseAbout');
  const elRestoreConfirmModal = document.getElementById('restoreConfirmModal');
  const elBtnCancelRestore = document.getElementById('btnCancelRestore');
  const elBtnConfirmRestore = document.getElementById('btnConfirmRestore');
  const elLanguageSelect = document.getElementById('languageSelect');

  function appendLog(line) {
    operationLogs.push(line);
    elLogContent.textContent = operationLogs.join('\n');
    elLogContent.scrollTop = elLogContent.scrollHeight;
  }

  function setOperatingState(operating, stage, detail) {
    isOperating = operating;
    elStatusCard.classList.toggle('is-operating', operating);
    elLanguageSelect.disabled = operating;
    if (operating) {
      elProgressBox.classList.remove('hidden');
      elProgressStage.textContent = translate(stage || '正在处理...');
      elProgressDetail.textContent = translate(detail || '请稍候...');
      elBtnPrimaryAction.disabled = true;
      elBtnSecondaryAction.disabled = true;
      elBtnRestore.disabled = true;
      elBtnChangePath.disabled = true;
    } else {
      elProgressBox.classList.add('hidden');
      elBtnPrimaryAction.disabled = false;
      elBtnSecondaryAction.disabled = false;
      elBtnRestore.disabled = false;
      elBtnChangePath.disabled = false;
    }
  }

  async function refreshStatus() {
    try {
      if (!window.go || !window.go.main || !window.go.main.App) {
        return;
      }
      const status = await window.go.main.App.GetStatus();
      currentStatus = status;
      renderStatus(status);
    } catch (err) {
      console.error('获取状态失败:', err);
      elStatusDesc.textContent = '获取状态失败: ' + (err.message || err);
    }
  }

  function renderStatus(s) {
    if (!s) return;
    if (s.locale) renderLanguage(s.locale);

    // Path & version info
    if (s.installDir) {
      elCursorPathDisplay.textContent = s.installDir;
      elCursorPathDisplay.title = s.installDir;
    } else {
      elCursorPathDisplay.textContent = translate('未检测到 Cursor 安装目录');
      elCursorPathDisplay.title = translate('点击更改路径');
    }
    elCursorVersion.textContent = s.cursorVersion ? 'v' + s.cursorVersion : translate('未知版本');

    // Pill style & label
    elStatusPill.className = 'status-pill';
    elBtnSecondaryAction.classList.add('hidden');
    elBtnRestore.classList.add('hidden');

    switch (s.state) {
      case 'not_found':
        elStatusPill.classList.add('danger');
        elStatusLabel.textContent = '未找到 Cursor';
        elStatusDesc.textContent = s.message || '请点击「更改位置」手动定位 Cursor 安装目录。';
        elBtnPrimaryAction.textContent = '选择 Cursor 路径';
        break;

      case 'cursor_running':
        elStatusPill.classList.add('warning');
        elStatusLabel.textContent = 'Cursor 运行中';
        elStatusDesc.textContent = s.message || 'Cursor 正在运行，请先退出 Cursor 再应用或撤销汉化。';
        elBtnPrimaryAction.textContent = '重新检测状态';
        if (s.canRestore) elBtnRestore.classList.remove('hidden');
        break;

      case 'unpatched':
        elStatusPill.classList.add('default');
        elStatusLabel.textContent = '未汉化（原版）';
        elStatusDesc.textContent = s.message || '当前 Cursor 为原版未汉化状态，可一键应用中文本地化。';
        elBtnPrimaryAction.textContent = '应用汉化';
        if (s.canRestore) elBtnRestore.classList.remove('hidden');
        break;

      case 'patched_current':
        elStatusPill.classList.add('success');
        elStatusLabel.textContent = '已汉化（正常）';
        elStatusDesc.textContent = s.message || '已成功应用中文本地化，所有校验与运行组件正常。';
        elBtnPrimaryAction.textContent = '打开 Cursor';
        elBtnSecondaryAction.classList.remove('hidden');
        elBtnSecondaryAction.textContent = '重新应用';
        elBtnRestore.classList.remove('hidden');
        break;

      case 'corrupted_checksum':
        elStatusPill.classList.add('warning');
        elStatusLabel.textContent = '需修复校验';
        elStatusDesc.textContent = s.message || '检测到文件被外部修改或校验不一致，建议同步校验。';
        elBtnPrimaryAction.textContent = '一键修复校验';
        elBtnRestore.classList.remove('hidden');
        break;

      case 'patched_outdated':
      default:
        elStatusPill.classList.add('warning');
        elStatusLabel.textContent = '需更新汉化';
        elStatusDesc.textContent = s.message || '检测到残留或不完整汉化组件，建议重新应用汉化。';
        elBtnPrimaryAction.textContent = '更新汉化';
        elBtnRestore.classList.remove('hidden');
        break;
    }
    for (const element of [elStatusLabel, elStatusDesc, elBtnPrimaryAction, elBtnSecondaryAction]) {
      element.textContent = translate(element.textContent);
    }
  }

  async function handlePrimaryAction() {
    if (isOperating || !currentStatus) return;

    if (currentStatus.state === 'not_found') {
      handleChangePath();
      return;
    }
    if (currentStatus.state === 'cursor_running') {
      await refreshStatus();
      return;
    }
    if (currentStatus.state === 'patched_current') {
      // Launch Cursor directly
      try {
        await window.go.main.App.LaunchCursor();
      } catch (e) {
        alert(translate('启动 Cursor 失败: ') + (e.message || e));
      }
      return;
    }

    // Apply localization
    await doApply();
  }

  async function doApply() {
    setOperatingState(true, '正在应用汉化', '正在准备语言包与翻译资源...');
    appendLog('[操作] 开始应用汉化...');
    try {
      const res = await window.go.main.App.ApplyLocalization();
      if (res && res.logs) {
        res.logs.forEach(appendLog);
      }
      if (res && res.success) {
        appendLog('[完成] ' + res.message);
      } else {
        const msg = res && res.error ? res.error : '未知错误';
        appendLog('[错误] ' + msg);
        alert(translate('应用汉化失败: ') + msg);
      }
    } catch (err) {
      appendLog('[异常] ' + (err.message || err));
      alert(translate('应用汉化失败: ') + (err.message || err));
    } finally {
      setOperatingState(false);
      await refreshStatus();
    }
  }

  async function doRestore() {
    elRestoreConfirmModal.classList.add('hidden');
    setOperatingState(true, '正在撤销汉化', '正在移除注入并恢复校验...');
    appendLog('[操作] 开始撤销汉化...');
    try {
      const res = await window.go.main.App.RestoreLocalization();
      if (res && res.logs) {
        res.logs.forEach(appendLog);
      }
      if (res && res.success) {
        appendLog('[完成] ' + res.message);
      } else {
        const msg = res && res.error ? res.error : '未知错误';
        appendLog('[错误] ' + msg);
        alert(translate('撤销汉化失败: ') + msg);
      }
    } catch (err) {
      appendLog('[异常] ' + (err.message || err));
      alert(translate('撤销汉化失败: ') + (err.message || err));
    } finally {
      setOperatingState(false);
      await refreshStatus();
    }
  }

  async function handleChangePath() {
    let selected;
    try {
      selected = await window.go.main.App.SelectCursorDir();
    } catch (e) {
      appendLog('[异常] 打开目录选择器失败: ' + (e.message || e));
      return;
    }
    if (!selected) return;
    try {
      const status = await window.go.main.App.SetCursorDir(selected);
      currentStatus = status;
      renderStatus(status);
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      appendLog('[错误] ' + msg);
      alert(msg);
    }
  }

  function showUpdateError(msg) {
    elUpdateText.textContent = translate('检查更新失败: ') + msg;
    elUpdateText.title = msg;
    elBtnUpdateAction.textContent = translate('重试');
    elBtnUpdateAction.classList.remove('hidden');
    elBtnUpdateAction.onclick = checkAppUpdate;
  }

  async function checkAppUpdate() {
    elBtnUpdateAction.classList.add('hidden');
    elUpdateText.title = '';
    try {
      elUpdateText.textContent = translate('检查新版本...');
      const info = await window.go.main.App.CheckAppUpdate();
      if (!info) {
        showUpdateError('未返回更新信息');
        return;
      }
      if (info.error) {
        showUpdateError(info.error);
        return;
      }
      if (!info.configured) {
        elUpdateText.textContent = translate('未配置更新源（本地构建版本）');
        return;
      }
      if (info.available) {
        elUpdateText.textContent = translate('发现新版本 ') + `${info.latestVersion}（` + translate('当前 ') + `${info.currentVersion}）`;
        elUpdateText.title = info.releaseNotes || '';
        elBtnUpdateAction.textContent = translate('更新并重启');
        elBtnUpdateAction.classList.remove('hidden');
        elBtnUpdateAction.onclick = doAppUpdate;
        return;
      }
      elUpdateText.textContent = translate('已是最新版本 ') + info.currentVersion;
    } catch (e) {
      showUpdateError(e && e.message ? e.message : String(e));
    }
  }

  async function doAppUpdate() {
    if (isOperating) return;
    setOperatingState(true, '正在更新助手', '正在下载并校验新版本...');
    elBtnUpdateAction.disabled = true;
    let ok = false;
    try {
      const res = await window.go.main.App.ApplyAppUpdate();
      ok = !!(res && res.success);
      if (ok) {
        appendLog('[完成] ' + res.message);
        elUpdateText.textContent = res.message;
      } else {
        const msg = res && res.error ? res.error : '未知错误';
        appendLog('[错误] ' + msg);
        alert('更新失败: ' + msg);
      }
    } catch (e) {
      alert('更新失败: ' + (e.message || e));
    } finally {
      elBtnUpdateAction.disabled = false;
      if (!ok) setOperatingState(false);
    }
  }

  // Bind Listeners
  elLanguageSelect.addEventListener('change', async event => {
    const previous = currentLanguage;
    elLanguageSelect.disabled = true;
    try {
      const status = await window.go.main.App.SetLanguage(event.target.value);
      currentStatus = status;
      renderStatus(status);
      await checkAppUpdate();
    } catch (error) {
      renderLanguage(previous);
      alert(error.message || String(error));
    } finally {
      elLanguageSelect.disabled = false;
    }
  });
  elBtnPrimaryAction.addEventListener('click', handlePrimaryAction);
  elBtnSecondaryAction.addEventListener('click', doApply); // re-apply
  elBtnRestore.addEventListener('click', () => {
    elRestoreConfirmModal.classList.remove('hidden');
  });
  elBtnCancelRestore.addEventListener('click', () => {
    elRestoreConfirmModal.classList.add('hidden');
  });
  elBtnConfirmRestore.addEventListener('click', doRestore);
  elBtnChangePath.addEventListener('click', handleChangePath);

  elBtnAbout.addEventListener('click', () => {
    elAboutModal.classList.remove('hidden');
  });
  elBtnCloseAbout.addEventListener('click', () => {
    elAboutModal.classList.add('hidden');
  });

  elBtnToggleLogs.addEventListener('click', () => {
    elLogDrawer.classList.toggle('hidden');
  });
  elBtnCloseLogs.addEventListener('click', () => {
    elLogDrawer.classList.add('hidden');
  });
  elBtnCopyLogs.addEventListener('click', () => {
    navigator.clipboard.writeText(operationLogs.join('\n'))
      .then(() => alert(translate('日志已复制到剪贴板')))
      .catch(() => {});
  });

  // Setup Wails runtime event listeners
  function setupWailsEvents() {
    if (window.runtime && window.runtime.EventsOn) {
      window.runtime.EventsOn('progress', (data) => {
        if (data && isOperating) {
          if (data.stage) elProgressStage.textContent = translate(data.stage);
          if (data.detail) elProgressDetail.textContent = translate(data.detail);
          appendLog(`[进度] ${data.stage}: ${data.detail}`);
        }
      });
    }
  }

  // Initialization
  window.addEventListener('DOMContentLoaded', async () => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (/[\u3400-\u9fff]/.test(node.textContent) && !node.parentElement.closest('#languageSelect, script, #logContent, #cursorPathDisplay')) {
        staticLabels.push({ node, source: node.textContent });
      }
    }
    setupWailsEvents();
    // Wait briefly for Wails IPC initialization
    setTimeout(async () => {
      try {
        const v = await window.go.main.App.GetAppVersion();
        if (v) elAppVersionBadge.textContent = v;
      } catch (e) {}
      await refreshStatus();
      await checkAppUpdate();
    }, 150);
  });
})();
