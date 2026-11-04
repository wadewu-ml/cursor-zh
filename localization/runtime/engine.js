    // ================================================================
    // SECTION 2: 翻译引擎
    // ================================================================

    // __PARTIAL_FRAGMENTS_BLOCK__

    var SKIP_SELECTOR = '.monaco-editor, .overflow-guard, .view-lines, .editor-scrollable, .inputarea, .rename-input, .explorer-viewlet, [id="workbench.view.explorer"]';
    var SKIP_TAGS = new Set(['TEXTAREA', 'INPUT', 'SCRIPT', 'STYLE', 'CODE', 'PRE', 'NOSCRIPT']);

    // User input and conversation bodies (user/model messages) must never be rewritten.
    var PROTECTED_CONTENT_SELECTOR =
        'input, textarea, [contenteditable]:not([contenteditable="false"]), ' +
        '.agent-transcript-row-markdown, .agent-transcript-row .markdown-root, ' +
        '.composer-rendered-message .markdown-root, [data-message-kind="assistant"], ' +
        '.composer-human-message-content, .aislash-editor-input-readonly, ' +
        '[data-agent-transcript-human-bubble], .ui-agent-transcript-human-bubble, ' +
        '.assistant-message, .ui-markdown-body';

    function isProtectedContent(node) {
        var el = node && (node.nodeType === 3 ? node.parentElement : node);
        if (!el) return false;
        if (el.isContentEditable) return true;
        try {
            return !!(el.closest && el.closest(PROTECTED_CONTENT_SELECTOR));
        } catch (e) {
            return false;
        }
    }

    function normalizeText(text) {
        return text.replace(/\s+/g, ' ').trim();
    }

    function normalizeQuotes(text) {
        if (!text) return text;
        return text
            .replace(/[\u2018\u2019\u2032]/g, "'")
            .replace(/[\u201C\u201D\u2033]/g, '"');
    }

    function replaceFragments(text, fragments) {
        if (!text || !fragments || !fragments.length) return null;
        var result = normalizeQuotes(text);
        var changed = false;
        for (var i = 0; i < fragments.length; i++) {
            var from = normalizeQuotes(fragments[i][0]);
            var neo = result.split(from).join(fragments[i][1]);
            if (neo !== result) { result = neo; changed = true; }
        }
        return changed ? result : null;
    }

    function lookupTranslation(text) {
        if (!text) return null;

        var trimmed = text.trim();
        var normalized = normalizeText(text);
        var quoteNorm = normalizeQuotes(normalized);

        if (translationDictionary.has(trimmed)) return translationDictionary.get(trimmed);
        if (normalized !== trimmed && translationDictionary.has(normalized)) return translationDictionary.get(normalized);
        if (quoteNorm !== normalized && translationDictionary.has(quoteNorm)) return translationDictionary.get(quoteNorm);

        for (var i = 0; i < translationPatterns.length; i++) {
            var pair = translationPatterns[i];
            if (pair[0].test(trimmed)) return trimmed.replace(pair[0], pair[1]);
            if (normalized !== trimmed && pair[0].test(normalized)) return normalized.replace(pair[0], pair[1]);
            if (quoteNorm !== normalized && pair[0].test(quoteNorm)) return quoteNorm.replace(pair[0], pair[1]);
        }

        return null;
    }

    function replacePartialText(text) {
        if (!text) return null;

        if (/^[a-z][\w-]*(?:\.[A-Za-z][\w-]*){1,}$/i.test(text)) {
            return null;
        }

        var result = replaceFragments(text, PARTIAL_FRAGMENTS);
        if (result) return result;

        var normalized = normalizeText(text);
        if (normalized !== text) {
            result = replaceFragments(normalized, PARTIAL_FRAGMENTS);
            if (result) return result;
        }

        var quoteNorm = normalizeQuotes(normalized);
        result = quoteNorm;
        var changed = false;
        for (var i = 0; i < translationPatterns.length; i++) {
            var pair = translationPatterns[i];
            if (pair[0].test(result)) {
                result = result.replace(pair[0], pair[1]);
                changed = true;
            }
        }

        return changed ? result : null;
    }

    function isMenuRegion(el) {
        if (!el) return false;
        try {
            return !!(el.closest(
                '.monaco-menu, .monaco-menu-container, .context-view, [role="menu"], [role="menubar"], ' +
                '.ui-menu, .ui-menu__layout, .ui-menu__content, .ui-slash-menu, .ui-slash-menu__content'
            ));
        } catch (e) { return false; }
    }

    function isMenuTextNode(node) {
        if (!node || node.nodeType !== Node.TEXT_NODE) return false;
        var pel = node.parentElement;
        if (!pel || !isMenuRegion(pel)) return false;
        try {
            if (pel.closest('.keybinding, .submenu-indicator, .monaco-keybinding')) return false;
            if (pel.classList && pel.classList.contains('codicon')) return false;
            if (pel.closest(
                '.action-label, .ui-menu__item-title, .ui-menu__item-content, .ui-menu__title, ' +
                '.ui-menu__section-title, .ui-slash-menu__item-title, .text-dropdown-foreground'
            )) return true;
            var item = pel.closest(
                'a.action-menu-item, .action-item, [role="menuitem"], [role="option"], li.action-item, ' +
                '.ui-menu__row, .ui-menu__item, [class*="ui-menu__item"]'
            );
            if (!item) return false;
            if (pel.querySelector && pel.querySelector('.codicon, .keybinding, .submenu-indicator, .action-label')) return false;
            return true;
        } catch (e) { return false; }
    }

    function lookupMenuHint(text, hints) {
        if (!text || !hints) return null;
        var norm = normalizeText(text);
        for (var j = 0; j < hints.length; j++) {
            if (norm === hints[j][0] || text === hints[j][0]) return hints[j][1];
        }
        return lookupTranslation(text) || lookupTranslation(norm) || replacePartialText(norm);
    }

    function updateMenuLabel(labelEl, tr) {
        if (!labelEl || !tr) return false;
        var raw = (labelEl.textContent || '').trim();
        if (!raw || normalizeText(raw) === normalizeText(tr)) return false;
        labelEl.textContent = tr;
        return true;
    }

    function translateMenuTextNodes(root, hints) {
        if (!root) return;
        var walker;
        try {
            walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
        } catch (e) { return; }
        var tnode;
        while ((tnode = walker.nextNode())) {
            if (!isMenuTextNode(tnode)) continue;
            var raw = (tnode.textContent || '').trim();
            if (!raw || raw.length > 160) continue;
            var tr = lookupMenuHint(raw, hints);
            if (tr && tr !== raw) tnode.textContent = tr;
        }
    }

    function translateEditorMenuItems(root) {
        if (!root) return;
        var hints = EDITOR_MENU_HINTS;
        var labels = root.querySelectorAll('.action-label, [class*="action-label"], .monaco-action-bar .label');
        for (var i = 0; i < labels.length; i++) {
            var el = labels[i];
            if (el.closest('.view-lines')) continue;
            var row = el.closest('a.action-menu-item, .action-item, [role="menuitem"], li.action-item');
            if (row) translateAttributes(row);
            translateAttributes(el);
            updateMenuText(el, hints);
        }
        var items = root.querySelectorAll('a.action-menu-item, .action-item, [role="menuitem"], li.action-item');
        for (var j = 0; j < items.length; j++) {
            translateAttributes(items[j]);
        }
        translateMenuTextNodes(root, hints);
    }

    function translateMonacoMenu(root) {
        if (!root) return;
        var labels = root.querySelectorAll('.action-label, [class*="action-label"]');
        for (var i = 0; i < labels.length; i++) {
            var el = labels[i];
            if (el.closest('.view-lines')) continue;
            var row = el.closest('a.action-menu-item, .action-item, [role="menuitem"], li.action-item');
            if (row) translateAttributes(row);
            translateAttributes(el);
            updateMenuText(el, EDITOR_MENU_HINTS);
            var raw = (el.textContent || '').trim();
            if (!raw || raw.length > 160) continue;
            var tr = lookupMenuHint(raw, EDITOR_MENU_HINTS);
            if (tr) updateMenuLabel(el, tr);
        }
        var items = root.querySelectorAll('a.action-menu-item, .action-item, [role="menuitem"], li.action-item');
        for (var j = 0; j < items.length; j++) {
            var item = items[j];
            translateAttributes(item);
            if (item.querySelector('.action-label, [class*="action-label"]')) continue;
            translateMenuTextNodes(item, EDITOR_MENU_HINTS);
        }
        translateMenuTextNodes(root, EDITOR_MENU_HINTS);
    }

    var menuTranslationTimer = null;
    var menuTranslationRetry = 0;

    function runMenuTranslation() {
        isBatchTranslationRunning = true;
        try {
            var menus = document.querySelectorAll(
                '.context-view, .monaco-menu-container, .monaco-menu, [role="menu"], ' +
                '.ui-menu, .ui-menu__layout, .ui-menu__content, ' +
                '.ui-slash-menu, .ui-slash-menu__content'
            );
            for (var m = 0; m < menus.length; m++) {
                try { translateMonacoMenu(menus[m]); } catch (e) {}
                try { translateEditorMenuItems(menus[m]); } catch (e) {}
                try { translateUIMenu(menus[m]); } catch (e) {}
                try {
                    var commonLabels = menus[m].querySelectorAll('.action-label');
                    for (var ty = 0; ty < commonLabels.length; ty++) {
                        updateMenuText(commonLabels[ty], COMMON_MENU_HINTS);
                        updateMenuText(commonLabels[ty], EDITOR_MENU_HINTS);
                    }
                } catch (e) {}
            }
            try { translateChatMenu(); } catch (e) {}
            try { translateMentionMenu(); } catch (e) {}
            try { localizeEditorContextMenu(); } catch (e) {}
            try { localizePendingChangesMenu(); } catch (e) {}
            try { localizeChatHistory(); } catch (e) {}
            try { scanAllMenus(); } catch (e) {}
        } finally {
            isBatchTranslationRunning = false;
        }
    }

    function scheduleMenuTranslation(forceRestart) {
        if (menuTranslationTimer && !forceRestart) return;
        if (menuTranslationTimer) clearTimeout(menuTranslationTimer);
        if (forceRestart) menuTranslationRetry = 0;
        menuTranslationTimer = setTimeout(function queueMenuTranslation() {
            menuTranslationTimer = null;
            runMenuTranslation();
            if (menuTranslationRetry < 8) {
                menuTranslationRetry++;
                var menuDelay = [50, 120, 220, 400, 700, 1100, 1600, 2200];
                menuTranslationTimer = setTimeout(queueMenuTranslation, menuDelay[menuTranslationRetry - 1] || 2200);
            }
        }, 16);
    }

    var dynamicMenuObserver = null;
    var dynamicMenuObserverRoot = null;

    function isBuildMenu(node) {
        if (!node) return false;
        var el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        if (!el || el.nodeType !== 1) return false;
        if (isMenuRegion(el)) return true;
        return nodeHasContextMenu(el);
    }

    function installDynamicMenuObserver() {
        if (dynamicMenuObserver) return;
        dynamicMenuObserver = new MutationObserver(function(mutations) {
            if (isBatchTranslationRunning) return;
            for (var i = 0; i < mutations.length; i++) {
                var m = mutations[i];
                var target = m.target;
                var targetEl = target && (target.nodeType === 1 ? target : target.parentElement);
                if (m.type === 'characterData') {
                    if (targetEl && targetEl.closest && targetEl.closest('.view-lines, textarea, input')) continue;
                    if (isBuildMenu(target)) {
                        try { rewriteMenuTextNode(target); } catch (e5) {}
                        scheduleMenuTranslation(false);
                        return;
                    }
                    continue;
                }
                if (isBuildMenu(target)) {
                    try { scanAllMenus(); } catch (e3) {}
                    scheduleMenuTranslation(false);
                    return;
                }
                var added = m.addedNodes;
                if (!added) continue;
                for (var j = 0; j < added.length; j++) {
                    if (isBuildMenu(added[j])) {
                        try { scanAllMenus(); } catch (e4) {}
                        scheduleMenuTranslation(false);
                        return;
                    }
                }
            }
        });
        try {
            dynamicMenuObserver.observe(document.body || document.documentElement, {
                childList: true,
                subtree: true,
                characterData: true
            });
            dynamicMenuObserverRoot = document.body;
        } catch (e) {}
        function triggerMenuTranslation() {
            try { scanAllMenus(); } catch (e0) {}
            setTimeout(function() {
                try { scanAllMenus(); } catch (e1) {}
                scheduleMenuTranslation(true);
                try { translateBrowserWebview(); } catch (e2) {}
            }, 0);
        }
        document.addEventListener('contextmenu', triggerMenuTranslation, true);
        document.addEventListener('click', function(ev) {
            var t = ev && ev.target;
            if (!t || !t.closest) return;
            if (t.closest('.context-view, .monaco-menu, .ui-menu, [role="menu"]')) {
                try { scanAllMenus(); } catch (e3) {}
                return;
            }
            if (t.closest(
                '[aria-haspopup], [aria-expanded="true"], [data-state="open"], ' +
                '[class*="agent"], [class*="chat-history"], [class*="ChatHistory"], [id*="agents"]'
            )) triggerMenuTranslation();
        }, true);
    }

    var mentionTranslationTimer = null;
    var mentionTranslationRetry = 0;

    function runMentionMenuTranslation() {
        isBatchTranslationRunning = true;
        try {
            translateMentionMenu();
            var menus = document.querySelectorAll(
                '.ui-slash-menu, .ui-slash-menu__content, .ui-menu, .ui-menu__layout, .ui-menu__content'
            );
            for (var m = 0; m < menus.length; m++) {
                try { translateUIMenu(menus[m]); } catch (e) {}
            }
            var hover = document.querySelector('.monaco-hover, .cursorHoverWidget, [role="tooltip"]');
            if (hover) translateMonacoHoverContent(hover);
        } finally {
            isBatchTranslationRunning = false;
        }
    }

    function scheduleMentionTranslation() {
        if (mentionTranslationTimer) clearTimeout(mentionTranslationTimer);
        mentionTranslationRetry = 0;
        mentionTranslationTimer = setTimeout(function queueMentionTranslation() {
            mentionTranslationTimer = null;
            runMentionMenuTranslation();
            if (mentionTranslationRetry < 2) {
                mentionTranslationRetry++;
                mentionTranslationTimer = setTimeout(queueMentionTranslation, mentionTranslationRetry === 1 ? 120 : 400);
            }
        }, 16);
    }

    var MENTION_MENU_HINTS = [
        ['Mentions', '提及'],
        ['Files & Folders', '文件和文件夹'],
        ['Terminals', '终端'],
        ['Past Chats', '历史对话'],
        ['Branch (Diff with Main)', '分支（与主分支的差异）'],
        ['Changes from current branch to main branch', '当前分支与主分支的差异'],
        ['No available options', '暂无可用选项'],
        ['Results', '结果']
    ];

    var COMMON_MENU_HINTS = [
        ['Copy', '复制'],
        ['Select All', '全选'],
        ['Search with Google', '使用 Google 搜索'],
        ['Cut', '剪切'],
        ['Paste', '粘贴']
    ];

    var MENUBAR_HINTS = [
        ['File', '文件'],
        ['Edit', '编辑'],
        ['Selection', '选择'],
        ['View', '查看'],
        ['Go', '转到'],
        ['Terminal', '终端'],
        ['Help', '帮助']
    ];

    var EDITOR_MENU_HINTS = [
        ['Add Symbol to Current Chat', '将符号添加到当前对话'],
        ['Add Symbol to Current Chat...', '将符号添加到当前对话...'],
        ['Add Symbol to New Chat', '将符号添加到新对话'],
        ['Add Symbol to New Chat...', '将符号添加到新对话...'],
        ['Create Rule', '创建规则'],
        ['Create Rule from Selection', '从选区创建规则'],
        ['Add to Chat', '添加到聊天'],
        ['Quick Edit', '快速编辑'],
        ['Insert Table', '插入表格'],
        ['Insert Table of Contents', '插入目录'],
        ['Open as Text Editor', '以文本编辑器打开'],
        ['Compare as Text', '以文本方式比较'],
        ['Open with Markdown Editor (WYSIWYG)', '使用 Markdown 编辑器（所见即所得）打开']
    ];

    var CHAT_MENU_HINTS = [
        ['Open in New Tab', '在新标签页中打开'],
        ['Restore', '恢复'],
        ['Pin', '固定'],
        ['Unpin', '取消固定'],
        ['Delete', '删除'],
        ['Rename', '重命名'],
        ['Rename Chat', '重命名对话'],
        ['Keep All', '全部保留'],
        ['Undo All', '全部撤销'],
        ['Archive', '归档'],
        ['Unarchive', '取消归档'],
        ['Fork Chat', '分叉对话'],
        ['Fork chat', '分叉对话'],
        ['Forking chat', '正在分叉对话'],
        ['New Chat', '新对话'],
        ['Agent Conversations', '智能体对话'],
        ['Fork Conversation', '分叉对话'],
        ['Fork', '分叉'],
        ['Export Chat', '导出对话'],
        ['Copy Message', '复制消息'],
        ['Copy Messages', '复制消息'],
        ['Copy ID', '复制 ID'],
        ['Copy Branch', '复制分支'],
        ['Copy Transcript', '复制对话记录'],
        ['Copy Branch Name', '复制分支名称'],
        ['Split Right', '向右拆分'],
        ['Split Down', '向下拆分'],
        ['Mark as Read', '标记为已读'],
        ['Mark as Unread', '标记为未读'],
        ['Archive Prior Chats', '归档较早的对话']
    ];

    var CHAT_HISTORY_HINTS = [
        ['Search Agents...', '搜索智能体...'],
        ['Search agents, files, actions...', '搜索智能体、文件、操作...'],
        ['Recent Agents', '最近智能体'],
        ['Grouping', '分组'],
        ['Ordering', '排序'],
        ['Filters', '筛选'],
        ['Created', '创建时间'],
        ['Group by Workspace', '按工作区分组'],
        ['Clear Filter', '清除筛选'],
        ['Change Filter', '更改筛选'],
        ['Select', '选择'],
        ['Author', '作者'],
        ['Inactive', '未激活'],
        ['Untitled', '未命名'],
        ['Edit Details', '编辑详情'],
        ['Duplicate', '创建副本'],
        ['Copy as JSON', '复制为 JSON'],
        ['Triggers', '触发器'],
        ['Add Trigger', '添加触发器'],
        ['Select repository', '选择仓库'],
        ['Test run', '测试运行'],
        ['Memories', '记忆'],
        ['Agent Mode', '智能体模式'],
        ['Today', '今天'],
        ['Yesterday', '昨天'],
        ['Older', '更早'],
        ['Last 7 Days', '最近 7 天'],
        ['Last 14 Days', '最近 14 天'],
        ['Last 30 Days', '最近 30 天'],
        ['Last 90 Days', '最近 90 天'],
        ['All Time', '全部时间'],
        ['Archived', '已归档'],
        ['Show Chat History', '显示聊天历史'],
        ['Chat History', '聊天历史'],
        ['Show more', '显示更多'],
        ['Show less', '显示更少'],
        ['Show 1 more', '再显示 1 条'],
        ['New Chat', '新对话'],
        ['Agent Conversations', '智能体对话']
    ];

    var AGENT_CHANGE_COMMON_HINTS = [
        ['All Changes', '全部更改'],
        ['Latest', '最新'],
        ['Diff Against...', '差异对比...'],
        ['Agent Changes', '智能体更改'],
        ['Undo File', '撤销文件'],
        ['Keep File', '保留文件'],
        ['Accept all changes', '接受所有更改'],
        ['Keep all changes', '保留所有更改'],
        ['Keep changes', '保留更改'],
        ['Review Next File', '审查下一个文件'],
        ['No Uncommitted Changes', '无未提交的更改'],
        ['Branch Commits', '分支提交'],
        ['Find in Changes', '在更改中查找'],
        ['Find in Diff', '在差异中查找'],
        ['Refresh Changes', '刷新更改'],
        ['Ignore Whitespace', '忽略空白字符'],
        ['Word Wrap', '自动换行']
    ];

    var AGENT_CHANGE_PENDING_HINTS = [
        ['Changes waiting to be confirmed', '等待确认的更改'],
        ['Pending Changes', '待确认更改']
    ];

    var AGENT_CHANGE_TEXT_HINTS = AGENT_CHANGE_PENDING_HINTS.concat([
        ['Keep', '保留'],
        ['Keep Ctrl+Shift+Y', '保留 Ctrl+Shift+Y'],
        ['Undo Ctrl+N', '撤销 Ctrl+N']
    ]);

    var AGENT_CHANGE_ATTRIBUTE_HINTS = [
        ['Keep', '保留'],
        ['Keep Ctrl+Shift+Y', '保留 Ctrl+Shift+Y']
    ];

    var CHAT_COMMON_HINTS = [
        ['Show context usage', '显示上下文用量'],
        ['Add files', '添加文件'],
        ['Edit selected code', '编辑所选代码'],
        ['Edit Selection', '编辑选区'],
        ['Rename Chat', '重命名对话'],
        ['Open as Editor', '在编辑器中打开'],
        ['Open in New Tab', '在新标签页中打开'],
        ['Restore', '恢复'],
        ['Pin', '固定'],
        ['Delete', '删除'],
        ['Rename', '重命名'],
        ['Keep All', '全部保留'],
        ['Undo All', '全部撤销'],
        ['Close Chat', '关闭对话'],
        ['Close Other Chats', '关闭其他对话'],
        ['How did the agent do?', '智能体表现如何？'],
        ['Response A is Better', '回复 A 更好'],
        ['Response B is Better', '回复 B 更好'],
        ['New Agent (Ctrl+N)', '新建智能体 (Ctrl+N)'],
        ['[Alt] Replace Agent', '[Alt] 替换智能体'],
        ['Voice Input', '语音输入'],
        ['Send now', '立即发送'],
        ['Send After Current Message', '在当前消息之后发送'],
        ['Send after current message', '在当前消息之后发送'],
        ['Send Right Away', '立即发送'],
        ['Edit queued message', '编辑排队消息'],
        ['Editing queued message', '正在编辑排队消息'],
        ['Editing queued message...', '正在编辑排队消息...'],
        ['Edit Queued', '编辑排队'],
        ['Attached image', '附加图片'],
        ['View image', '查看图片'],
        ['Remove from queue', '从队列移除'],
        ['Revert last change', '撤销上次更改'],
        ['Queued', '已排队'],
        ['Show conversation', '显示对话'],
        ['Send follow-up', '发送后续消息'],
        ['Select Model', '选择模型'],
        ['Modes, skills, MCPs and more', '模式、技能、MCP 等']
    ];

    var CHAT_ATTRIBUTE_HINTS = [
        ['Replace Agent', '替换智能体'],
        ['Switch Model', '切换模型'],
        ['Switch to Auto', '切换到自动'],
        ['Switch Model and Retry', '切换模型并重试']
    ];

    var CHAT_TEXT_HINTS = [
        ['System prompt', '系统提示词'],
        ['Tool definitions', '工具定义'],
        ['Subagent definitions', '子智能体定义'],
        ['Summarized conversation', '摘要对话'],
        ['Conversation', '对话']
    ];

    var BROWSER_TOOLBAR_HINTS = [
        ['Navigate back', '后退'],
        ['Navigate forward', '前进'],
        ['Hard reload (clears cache)', '强制重新加载（清除缓存）'],
        ['Go Back', '返回'],
        ['Go Forward', '前进'],
        ['Back', '返回'],
        ['Forward', '前进'],
        ['Reload', '重新加载'],
        ['Refresh', '刷新'],
        ['Hard Reload', '强制重新加载'],
        ['New Tab', '新建标签页'],
        ['Enter Full Screen', '进入全屏'],
        ['Exit Full Screen', '退出全屏'],
        ['Show Sidebar', '显示侧栏'],
        ['Hide Sidebar', '隐藏侧栏'],
        ['Select element', '选择元素'],
        ['Show Console', '显示控制台'],
        ['Hide Console', '隐藏控制台'],
        ['Show CSS Inspector', '显示 CSS 检查器'],
        ['Hide CSS Inspector', '隐藏 CSS 检查器'],
        ['Enter design mode', '进入设计模式'],
        ['Exit design mode', '退出设计模式'],
        ['Favorites, Recents', '收藏、最近']
    ];

    function updateMenuText(el, hints) {
        if (!el || el.closest('.view-lines')) return;
        translateAttributes(el);
        var text = normalizeText(el.textContent || '');
        if (!text || text.length > 160) return;
        var tr = lookupMenuHint(text, hints);
        if (tr && tr !== text) updateMenuLabel(el, tr);
    }

    function translateMentionMenu() {
        var hints = MENTION_MENU_HINTS;
        var menus = document.querySelectorAll(
            '.ui-slash-menu, .ui-slash-menu__content, .ui-menu, .ui-menu__layout, .ui-menu__content, ' +
            '.context-view, [role="menu"]'
        );
        for (var m = 0; m < menus.length; m++) {
            var scope = menus[m];
            var els;
            try {
                els = scope.querySelectorAll(
                    '.ui-slash-menu__item-title, .ui-slash-menu__item-title-primary, ' +
                    '.ui-slash-menu__item-title-secondary, .ui-slash-menu__structured-tooltip-title, ' +
                    '.ui-slash-menu__structured-tooltip-description, ' +
                    '.ui-menu__item-title, .ui-menu__item-content, .ui-menu__item-description, ' +
                    '.ui-menu__section-title, .ui-menu__title, .text-dropdown-foreground'
                );
            } catch (e) { continue; }
            for (var i = 0; i < els.length; i++) {
                updateMenuText(els[i], hints);
            }
            try {
                var leaves = scope.querySelectorAll(
                    '.ui-slash-menu__content span, .ui-slash-menu__content div, ' +
                    '.ui-menu__content span, .ui-menu__content div'
                );
                for (var li = 0; li < leaves.length; li++) {
                    var leaf = leaves[li];
                    if (leaf.closest('.view-lines')) continue;
                    if (leaf.querySelector && leaf.querySelector('span, div, button, input, select')) continue;
                    updateMenuText(leaf, hints);
                }
            } catch (e) {}
        }
    }

    function translateUIMenu(root) {
        var scope = root || document;
        var hints = CHAT_MENU_HINTS.concat(MENTION_MENU_HINTS);
        var els;
        try {
            els = scope.querySelectorAll(
                '.ui-menu__item-title, .ui-menu__item-content, .ui-menu__item-description, .ui-menu__title, ' +
                '.ui-menu__section-title, .ui-menu__section-text-action, ' +
                '.ui-slash-menu__item-title, .ui-slash-menu__item-title-primary, .ui-slash-menu__item-title-secondary, ' +
                '.text-dropdown-foreground'
            );
        } catch (e) { return; }
        for (var i = 0; i < els.length; i++) {
            updateMenuText(els[i], hints);
        }
        try {
            var rows = scope.querySelectorAll('.ui-menu__row, .ui-menu__toggle-row');
            for (var r = 0; r < rows.length; r++) translateAttributes(rows[r]);
        } catch (e) {}
    }

    function translateChatMenu() {
        var hints = CHAT_MENU_HINTS;
        var menus = collectMenuRoots();
        for (var m = 0; m < menus.length; m++) {
            translateUIMenu(menus[m]);
            var labels = menus[m].querySelectorAll('.action-label, [role="menuitem"], .ui-menu__item-title');
            for (var i = 0; i < labels.length; i++) {
                updateMenuText(labels[i], hints);
            }
            scanMenu(menus[m]);
        }
    }

    var MENU_TRANSLATIONS = null;
    var observedMenus = typeof WeakSet !== 'undefined' ? new WeakSet() : null;
    var isWritingMenu = false;

    function getMenuTranslations() {
        if (MENU_TRANSLATIONS) return MENU_TRANSLATIONS;
        var map = new Map();
        var lists = [
            EDITOR_MENU_HINTS,
            CHAT_MENU_HINTS,
            CHAT_HISTORY_HINTS,
            COMMON_MENU_HINTS,
            MENTION_MENU_HINTS
        ];
        for (var i = 0; i < lists.length; i++) {
            var arr = lists[i] || [];
            for (var j = 0; j < arr.length; j++) {
                if (arr[j] && arr[j][0] && arr[j][1]) map.set(arr[j][0], arr[j][1]);
            }
        }
        MENU_TRANSLATIONS = map;
        return map;
    }

    function lookupMenuTranslation(raw) {
        if (!raw) return null;
        var text = normalizeText(raw);
        if (!text || !/[A-Za-z]/.test(text) || text.length > 160) return null;
        var hit = getMenuTranslations().get(text);
        if (hit) return hit;
        return lookupTranslation(text) || lookupTranslation(raw);
    }

    function rewriteMenuTextNode(node) {
        if (!node || node.nodeType !== 3) return false;
        var pel = node.parentElement;
        if (!pel) return false;
        try {
            if (pel.closest('.keybinding, .monaco-keybinding, .submenu-indicator, .codicon, .view-lines')) return false;
        } catch (e) {}
        var raw = node.textContent || '';
        var trimmed = raw.trim();
        var tr = lookupMenuTranslation(trimmed);
        if (!tr || tr === trimmed) return false;
        var idx = raw.indexOf(trimmed);
        isWritingMenu = true;
        try {
            node.textContent = idx < 0 ? tr : raw.substring(0, idx) + tr + raw.substring(idx + trimmed.length);
        } finally {
            isWritingMenu = false;
        }
        return true;
    }

    function scanMenu(root) {
        if (!root) return;
        try {
            var items = root.querySelectorAll(
                'a.action-menu-item, .action-item, [role="menuitem"], [role="option"], ' +
                '.action-label, .ui-menu__item-title, .ui-menu__row'
            );
            for (var i = 0; i < items.length; i++) translateAttributes(items[i]);
        } catch (e1) {}
        var walker;
        try {
            walker = (root.ownerDocument || document).createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
        } catch (e2) { return; }
        var tnode;
        while ((tnode = walker.nextNode())) rewriteMenuTextNode(tnode);
    }

    function collectMenuRoots() {
        var out = [];
        var seen = typeof Set !== 'undefined' ? new Set() : null;
        function addRoot(node) {
            if (!node || (seen && seen.has(node))) return;
            if (seen) seen.add(node);
            out.push(node);
        }
        function collectRoots(root) {
            if (!root || !root.querySelectorAll) return;
            try {
                var menus = root.querySelectorAll(
                    '.context-view, .monaco-menu-container, .monaco-menu, [role="menu"], ' +
                    '.ui-menu, .ui-menu__layout, .ui-menu__content, .ui-slash-menu, .ui-slash-menu__content'
                );
                for (var i = 0; i < menus.length; i++) addRoot(menus[i]);
            } catch (e) {}
        }
        collectRoots(document);
        try {
            var hosts = document.querySelectorAll(
                '.monaco-workbench, .context-view, [class*="overlay"], [class*="glass"], [class*="shadow"]'
            );
            for (var h = 0; h < hosts.length; h++) {
                if (hosts[h].shadowRoot) collectRoots(hosts[h].shadowRoot);
            }
        } catch (e2) {}
        return out;
    }

    function scanAllMenus() {
        var menus = collectMenuRoots();
        for (var i = 0; i < menus.length; i++) {
            scanMenu(menus[i]);
            observeMenu(menus[i]);
        }
    }

    function observeMenu(menu) {
        if (!menu) return;
        try {
            if (observedMenus) {
                if (observedMenus.has(menu)) return;
                observedMenus.add(menu);
            }
        } catch (e) {}
        var obs = new MutationObserver(function(mutations) {
            if (isWritingMenu) return;
            for (var i = 0; i < mutations.length; i++) {
                var m = mutations[i];
                if (m.type === 'characterData') {
                    rewriteMenuTextNode(m.target);
                    continue;
                }
                var added = m.addedNodes;
                if (!added) continue;
                for (var j = 0; j < added.length; j++) {
                    var n = added[j];
                    if (n.nodeType === 3) rewriteMenuTextNode(n);
                    else if (n.nodeType === 1) scanMenu(n);
                }
            }
        });
        try {
            obs.observe(menu, { childList: true, subtree: true, characterData: true });
        } catch (e2) {}
    }

    function translateCommitScoreText(text) {
        if (!text || !/[A-Za-z]/.test(text)) return null;
        if (!/(?:Most Recent Commit Scored|AI-Generated:|Total Changes:|Agent Stats:|Tab Stats:|Agent AI Stats|Tab AI Stats|% AI\b)/i.test(text)) {
            return null;
        }
        var result = text;
        result = result.replace(/Most Recent Commit Scored:/g, '最近评分的提交：');
        result = result.replace(/AI-Generated:\s*([\d.]+)%\s*\((\d+)\s*lines?\)/gi, 'AI 生成：$1%（$2 行）');
        result = result.replace(/AI-Generated:/g, 'AI 生成：');
        result = result.replace(/- Tab:\s*([\d,]+)\s*lines?\s*\(([\d,]+)\s*added,\s*([\d,]+)\s*deleted\)/gi, '- Tab：$1 行（新增 $2，删除 $3）');
        result = result.replace(/- Composer:\s*([\d,]+)\s*lines?\s*\(([\d,]+)\s*added,\s*([\d,]+)\s*deleted\)/gi, '- Composer：$1 行（新增 $2，删除 $3）');
        result = result.replace(/Total Changes:\s*([\d,]+)\s*added,\s*([\d,]+)\s*deleted/gi, '总变更：新增 $1，删除 $2');
        result = result.replace(/Agent AI Stats \(Today\):\s*([\d,]+)\/([\d,]+)(?:\s*lines)?\s*\((\d+)%\)/gi, '智能体 AI 统计（今日）：$1/$2（$3%）');
        result = result.replace(/Agent Stats:\s*([\d,]+)\/([\d,]+)\s*\((\d+)%\)/gi, '智能体统计：$1/$2（$3%）');
        result = result.replace(/Tab AI Stats \(Today\):\s*([\d,]+)\/([\d,]+)(?:\s*lines)?\s*\((\d+)%\)/gi, 'Tab AI 统计（今日）：$1/$2（$3%）');
        result = result.replace(/Tab Stats:\s*([\d,]+)\/([\d,]+)\s*\((\d+)%\)/gi, 'Tab 统计：$1/$2（$3%）');
        result = result.replace(/Agent AI Stats \(Today\):/g, '智能体 AI 统计（今日）：');
        result = result.replace(/Agent Stats:/g, '智能体统计：');
        result = result.replace(/Tab AI Stats \(Today\):/g, 'Tab AI 统计（今日）：');
        result = result.replace(/Tab Stats:/g, 'Tab 统计：');
        if (/最近评分的提交|AI 生成：/.test(result)) {
            result = result.replace(/Repo:\s*([^\n\r]+)/g, '仓库：$1');
            result = result.replace(/Branch:\s*([^\n\r]+)/g, '分支：$1');
        }
        result = result.replace(/\b([a-f0-9]{7,40})\s+([\d.]+)%\s*AI\b/gi, '$1 $2% 由 AI 生成');
        return result !== text ? result : null;
    }

    function translateTextNode(node) {
        if (isProtectedContent(node)) return ;
        var text = node.textContent;
        if (!text) return;
        var trimmed = text.trim();
        if (!trimmed) return;
        var isCommitScoreText = /(?:Most Recent Commit Scored|AI-Generated:|Total Changes:)/i.test(trimmed);
        if (trimmed.length > (isCommitScoreText ? 800 : 500)) return;
        if (/^[\d\s.,;:!?@#$%^&*()\-+=<>\\/|~`'"[\]{}]+$/.test(trimmed)) return;
        try {
            if (node.parentElement && isMenuRegion(node.parentElement) && !isMenuTextNode(node)) return;
        } catch (e) {}
        if (trimmed === 'Stop') {
            try {
                var comboStop = node.parentElement && node.parentElement.closest(
                    '[role="combobox"], .monaco-select-box, [class*="select-box"]'
                );
                if (comboStop && /send\s+right\s+away/i.test(comboStop.textContent || '')) return;
            } catch (e) {}
        }

        if (isQuickInputRegion(node.parentElement)) {
            if (isTranslatedThemeName(trimmed)) return;
            var qiTr = lookupTranslation(trimmed);
            if (qiTr && qiTr !== trimmed) {
                var qiPrefix = text.substring(0, text.indexOf(trimmed));
                var qiSuffix = text.substring(text.indexOf(trimmed) + trimmed.length);
                node.textContent = qiPrefix + qiTr + qiSuffix;
            }
            return;
        }

        var result = lookupTranslation(text);
        if (!result) result = translateCommitScoreText(text) || translateCommitScoreText(trimmed);
        if (result) {
            var prefix = text.substring(0, text.indexOf(trimmed));
            var suffix = text.substring(text.indexOf(trimmed) + trimmed.length);
            node.textContent = prefix + result + suffix;
            return;
        }

        var partial = replacePartialText(text);
        if (partial) node.textContent = partial;
    }

    function translateTooltipText(val) {
        if (!val) return null;
        var direct = lookupTranslation(val);
        if (direct) return direct;
        var normalized = normalizeText(val);
        if (normalized !== val) {
            direct = lookupTranslation(normalized);
            if (direct) return direct;
        }
        if (/New Agent|Replace Agent/i.test(val)) {
            var agentNeo = val;
            for (var ai = 0; ai < AGENT_TOOLTIP_TEXT.length; ai++) {
                agentNeo = agentNeo.split(AGENT_TOOLTIP_TEXT[ai][0]).join(AGENT_TOOLTIP_TEXT[ai][1]);
            }
            if (agentNeo !== val) return agentNeo;
        }
        var translatedScore = translateCommitScoreText(val) || translateCommitScoreText(normalized);
        if (translatedScore) return translatedScore;
        return replacePartialText(val);
    }

    function translateAttributes(el) {
        if (!el || !el.getAttribute) return;
        var attrs = ['title', 'aria-label', 'alt', 'placeholder', 'aria-placeholder', 'data-tooltip', 'data-title'];
        for (var i = 0; i < attrs.length; i++) {
            var val = el.getAttribute(attrs[i]);
            if (!val) continue;
            var result = translateTooltipText(val);
            if (result && result !== val) el.setAttribute(attrs[i], result);
        }
    }

    function translateCursorHoverWidget(root) {
        if (!root) return;
        var list = [];
        try {
            if (root.nodeType === 1 && isTooltipNode(root)) list.push(root);
            if (root.querySelectorAll) {
                var found = root.querySelectorAll('.cursorHoverWidget, [class*="cursor-hover"], [class*="cursorHover"], [class*="CursorHover"]');
                for (var f = 0; f < found.length; f++) list.push(found[f]);
            }
        } catch (e) { return; }
        var seen = new Set();
        for (var h = 0; h < list.length; h++) {
            var ht = list[h];
            if (!ht || seen.has(ht)) continue;
            seen.add(ht);
            if (ht.closest && ht.closest('.monaco-editor .view-lines')) continue;
            translateAttributes(ht);
            try {
                var walker = document.createTreeWalker(ht, NodeFilter.SHOW_TEXT, null);
                var tnode;
                while ((tnode = walker.nextNode())) {
                    var text = tnode.textContent;
                    if (!text) continue;
                    var trimmed = text.trim();
                    if (!trimmed || trimmed.length > 800) continue;
                    var tr = lookupTranslation(trimmed) || translateCommitScoreText(text) || translateCommitScoreText(trimmed);
                    if (!tr) {
                        for (var j = 0; j < AGENT_TOOLTIP_TEXT.length; j++) {
                            if (trimmed === AGENT_TOOLTIP_TEXT[j][0]) {
                                tr = AGENT_TOOLTIP_TEXT[j][1];
                                break;
                            }
                        }
                    }
                    if (tr && tr !== text) {
                        var idx = text.indexOf(trimmed);
                        if (idx < 0) tnode.textContent = tr;
                        else tnode.textContent = text.substring(0, idx) + tr + text.substring(idx + trimmed.length);
                    }
                }
            } catch (e) {}
            var leaves = ht.querySelectorAll ? ht.querySelectorAll('div, span, p, label') : [];
            for (var n = 0; n < leaves.length; n++) {
                var leaf = leaves[n];
                if (!leaf || (leaf.querySelector && leaf.querySelector('div, span, p, label'))) continue;
                var raw = (leaf.textContent || '').trim();
                if (!raw || raw.length > 800) continue;
                var plain = normalizeText(raw);
                var ltr = lookupTranslation(plain) || translateCommitScoreText(raw) || translateCommitScoreText(plain);
                if (!ltr) {
                    for (var k = 0; k < AGENT_TOOLTIP_TEXT.length; k++) {
                        if (plain === AGENT_TOOLTIP_TEXT[k][0]) { ltr = AGENT_TOOLTIP_TEXT[k][1]; break; }
                    }
                }
                if (ltr && ltr !== raw) safelyRewriteText(leaf, ltr, [raw.slice(0, 10)]);
            }
        }
    }

  // 所有悬停 / tooltip 统一选择器（Monaco、Cursor 自定义、原生 title 浮层等）
    var TOOLTIP_SELECTOR = '.monaco-hover, .monaco-hover-content, [role="tooltip"], .cursorHoverWidget, ' +
        '[class*="cursor-hover"], [class*="cursorHover"], [class*="CursorHover"], ' +
        '.monaco-tooltip, [class*="hover-widget"], [class*="HoverWidget"], [class*="tooltip-content"]';

    var AGENT_TOOLTIP_TEXT = [
        ['New Agent (Ctrl+N)', '新建智能体 (Ctrl+N)'],
        ['New Agent(Ctrl+N)', '新建智能体 (Ctrl+N)'],
        ['[Alt] Replace Agent', '[Alt] 替换智能体'],
        ['[Alt]Replace Agent', '[Alt] 替换智能体'],
        ['Alt Replace Agent', 'Alt 替换智能体'],
        ['Replace Agent', '替换智能体']
    ];

    function isTooltipNode(el) {
        if (!el || el.nodeType !== 1) return false;
        try {
            if (el.matches && el.matches(TOOLTIP_SELECTOR)) return true;
            if (el.classList) {
                var cls = el.className && typeof el.className === 'string' ? el.className : '';
                if (/monaco-hover|cursorHoverWidget|hover-widget|HoverWidget|tooltip-content/i.test(cls)) return true;
            }
            if (el.getAttribute && el.getAttribute('role') === 'tooltip') return true;
        } catch (e) {}
        return false;
    }

    function translateTooltipSource(el) {
        if (!el) return;
        var cur = el;
        for (var depth = 0; depth < 4 && cur; depth++) {
            translateAttributes(cur);
            cur = cur.parentElement;
        }
    }

    function translateMonacoHoverContent(root) {
        if (!root) return;
        var list = [];
        try {
            if (root.nodeType === 1 && isTooltipNode(root)) list.push(root);
            if (root.querySelectorAll) {
                var found = root.querySelectorAll(TOOLTIP_SELECTOR);
                for (var f = 0; f < found.length; f++) list.push(found[f]);
            }
        } catch (e) { return; }
        var seen = new Set();
        for (var h = 0; h < list.length; h++) {
            var ht = list[h];
            if (!ht || seen.has(ht)) continue;
            seen.add(ht);
            if (ht.closest && ht.closest('.monaco-editor .view-lines')) continue;
            translateAttributes(ht);
            try {
                var walker = document.createTreeWalker(ht, NodeFilter.SHOW_TEXT, null);
                var tnode;
                while ((tnode = walker.nextNode())) {
                    var text = tnode.textContent;
                    if (!text) continue;
                    var trimmed = normalizeText(text);
                    if (!trimmed || trimmed.length > 800) continue;
                    var tr = translateTooltipText(text) || translateTooltipText(trimmed);
                    if (tr && tr !== text) {
                        var idx = text.indexOf(trimmed);
                        if (idx < 0) tnode.textContent = tr;
                        else {
                            tnode.textContent = text.substring(0, idx) + tr + text.substring(idx + trimmed.length);
                        }
                    }
                }
            } catch (e) {}
            var leaves = ht.querySelectorAll ? ht.querySelectorAll('span, div, p, label, a, button') : [];
            for (var n = 0; n < leaves.length; n++) {
                var leaf = leaves[n];
                if (!leaf || leaf.closest('.monaco-editor .view-lines')) continue;
                if (leaf.querySelector && leaf.querySelector('span, div, p, label')) continue;
                translateAttributes(leaf);
                var raw = leaf.textContent || '';
                if (!raw || raw.length > 800) continue;
                var plain = normalizeText(raw);
                var ltr = translateTooltipText(raw) || translateTooltipText(plain);
                if (ltr && ltr !== raw) safelyRewriteText(leaf, ltr, [plain.slice(0, 12)]);
            }
        }
    }

    function installMonacoHoverTranslation() {
        if (window.__cursorZhMonacoHoverTranslation) return;
        window.__cursorZhMonacoHoverTranslation = true;
        var hoverTimer = null;
        var hoverRafId = 0;
        function queueHoverTranslation(scope) {
            if (hoverTimer) clearTimeout(hoverTimer);
            hoverTimer = setTimeout(function() {
                hoverTimer = null;
                var target = scope;
                if (!target) {
                    try { target = document.querySelector(TOOLTIP_SELECTOR); } catch (e) {}
                }
                if (target) {
                    try { translateMonacoHoverContent(target); } catch (e) {}
                    try { translateCursorHoverWidget(target); } catch (e) {}
                }
            }, 32);
        }
        function startHoverTracking(seed) {
            if (hoverRafId) return;
            var frames = 0;
            function tick() {
                var active = seed || null;
                if (!active) {
                    try { active = document.querySelector(TOOLTIP_SELECTOR); } catch (e) {}
                }
                if (!active || frames >= 8) {
                    hoverRafId = 0;
                    return;
                }
                try { translateMonacoHoverContent(active); } catch (e) {}
                try { translateCursorHoverWidget(active); } catch (e) {}
                frames++;
                seed = null;
                hoverRafId = requestAnimationFrame(tick);
            }
            hoverRafId = requestAnimationFrame(tick);
        }
        function handleHoverChanges(node) {
            if (!node) return;
            if (node.nodeType === 1) {
                if (isTooltipNode(node)) {
                    try { translateMonacoHoverContent(node); } catch (e) {}
                    startHoverTracking();
                    return;
                }
                if (node.querySelector && node.querySelector(TOOLTIP_SELECTOR)) {
                    queueHoverTranslation();
                    startHoverTracking();
                }
            } else if (node.nodeType === 3 && node.parentElement) {
                var p = node.parentElement;
                if (p.closest && p.closest(TOOLTIP_SELECTOR.split(',')[0])) {
                    try { translateMonacoHoverContent(p.closest('.monaco-hover, .cursorHoverWidget, [role="tooltip"]') || document.body); } catch (e) {}
                }
            }
        }
        try {
            var hoverObs = new MutationObserver(function(mutations) {
                for (var i = 0; i < mutations.length; i++) {
                    var m = mutations[i];
                    if (m.type === 'childList') {
                        var added = m.addedNodes;
                        for (var j = 0; j < added.length; j++) handleHoverChanges(added[j]);
                    } else if (m.type === 'characterData' && m.target) {
                        handleHoverChanges(m.target);
                    }
                }
            });
            hoverObs.observe(document.body, { childList: true, subtree: true, characterData: true });
        } catch (e) {}
        document.addEventListener('mouseover', function(ev) {
            var target = ev.target;
            if (!target || !target.closest) return;
            var hoverEl = target.closest(TOOLTIP_SELECTOR.split(',')[0]);
            if (hoverEl) {
                queueHoverTranslation(hoverEl);
                startHoverTracking(hoverEl);
                return;
            }
            var actionBtn = target.closest(
                '.tabs-and-actions-container .action-item, .title-actions .action-item, ' +
                '.editor-actions .action-item, [class*="agent"] .action-item, [class*="composer"] .action-item'
            );
            if (actionBtn) {
                translateTooltipSource(actionBtn);
                var actionLabel = actionBtn.querySelector('.action-label, a, button');
                if (actionLabel) translateTooltipSource(actionLabel);
                queueHoverTranslation();
                startHoverTracking();
            }
            var src = target.closest('[title], [aria-label], [data-tooltip], [data-title]');
            if (src) translateTooltipSource(src);
        }, true);
        document.addEventListener('focusin', function(ev) {
            var src = ev.target && ev.target.closest && ev.target.closest('[title], [aria-label], [data-tooltip], [data-title]');
            if (src) translateTooltipSource(src);
        }, true);
    }

    function isPromptBarRegion(el) {
        if (!el) return false;
        try {
            return !!(el.closest(
                '.prompt-bar-container, .pure-ai-prompt-bar, .inline-prompt-button-area, ' +
                '.ui-prompt-input, [class*="ui-prompt-input"], [class*="prompt-bar"], [class*="pure-ai-prompt"], ' +
                '.contentWidgets, .overlayWidgets'
            ));
        } catch (e) { return false; }
    }

    function isQuickInputRegion(el) {
        if (!el) return false;
        try {
            return !!(el.closest('.quick-input-widget, .monaco-quick-input, [class*="quick-input-widget"]'));
        } catch (e) { return false; }
    }

    function isTranslatedThemeName(text) {
        if (!text) return false;
        return /[\u4e00-\u9fff]/.test(text) && /[A-Za-z]{2,}/.test(text);
    }

    function getPromptBarRoot() {
        return document.querySelectorAll(
            '.pure-ai-prompt-bar, .prompt-bar-container, .inline-prompt-button-area, ' +
            '.ui-prompt-input, [class*="ui-prompt-input"], [class*="prompt-bar"]'
        );
    }

    function isTranslatableTimeline(el) {
        if (!el) return false;
        try {
            if (el.closest('.timeline-tree-view, .timeline-view, [id="workbench.view.timeline"]')) return true;
            var header = el.closest('.pane-header, .composite.title, .pane-composite-part .title');
            if (header) {
                var ht = header.textContent || '';
                if (/时间线|Timeline/i.test(ht)) return true;
            }
        } catch (e) {}
        return false;
    }

    function isEditorRegion(node) {
        if (isProtectedContent(node)) return true;
        var el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        if (!el) return true;
        if (SKIP_TAGS.has(el.tagName)) return true;
        if (isPromptBarRegion(el)) return false;
        if (isTranslatableTimeline(el)) return false;
        try { if (el.closest(SKIP_SELECTOR)) return true; } catch (e) {}
        return false;
    }

    function shouldSkipEditorElement(el) {
        if (isProtectedContent(el)) return true;
        if (!el || el.nodeType !== 1) return true;
        if (isPromptBarRegion(el)) return false;
        if (isTranslatableTimeline(el)) return false;
        try { if (el.closest(SKIP_SELECTOR)) return true; } catch (e) {}
        return false;
    }

    function getSettingsRoot() {
        try {
            return document.querySelector('[class*="cursor-settings"]');
        } catch (e) {
            return null;
        }
    }

    function translateSubtree(root) {
        var stack = [root];
        while (stack.length > 0) {
            var node = stack.pop();
            if (node.nodeType === Node.ELEMENT_NODE) {
                if (SKIP_TAGS.has(node.tagName)) continue;
                if (shouldSkipSubtreeElement(node)) continue;
                var inPromptBar = isPromptBarRegion(node);
                if (!inPromptBar) {
                    if (node.classList && (node.classList.contains('overflow-guard') || node.classList.contains('view-lines') || node.classList.contains('editor-scrollable'))) continue;
                    if (isProtectedContent(node)) continue;
                }
                translateAttributes(node);
                var children = node.childNodes;
                for (var i = children.length - 1; i >= 0; i--) { stack.push(children[i]); }
            } else if (node.nodeType === Node.TEXT_NODE) {
                if (!isEditorRegion(node)) { translateTextNode(node); }
            }
        }
    }

    var pendingNodes = new Set();
    var isBatchScheduled = false;
    var isBatchTranslationRunning = false;
    var isGlobalTranslationQueued = false;
    var lastGlobalTranslationTime = 0;
    var accumulatedTaskFlags = 0;
    var activeTaskFlags = 0;

    var TASK_ALL = 0xffffffff;
    var TASK_INDEXING = 1;
    var TASK_CODEBASE = 2;
    var TASK_MODELS = 4;
    var TASK_SETTINGS = 8;
    var TASK_COMPOSER = 16;
    var TASK_BROWSER = 32;
    var TASK_EDITOR = 64;
    var TASK_MENUS = 128;
    var TASK_NOTIFICATIONS = 256;
    var TASK_DIALOGS = 512;
    var TASK_MARKETPLACE = 1024;
    var TASK_TIMELINE = 2048;
    var TASK_DESIGN = 4096;
    var TASK_WELCOME = 8192;
    var TASK_DROPDOWNS = 16384;
    var TASK_HOVERS = 32768;

    function mergeGlobalTaskFlags(taskFlags) {
        if (taskFlags) accumulatedTaskFlags |= taskFlags;
    }

    var MARKETPLACE_SELECTOR =
        '[class*="extension"], [class*="marketplace"], [class*="plugin"], ' +
        '.extension-list-item, .monaco-pane-view [aria-label*="Extension"], ' +
        '[aria-label*="扩展"], [aria-label*="Plugins"], ' +
        '[data-component^="add-plugin-"], [aria-label="Add Marketplace"], ' +
        '[aria-label="Remove marketplace confirmation"], ' +
        // Current Customize pages use generated CSS classes; identify their editor by UI controls.
        '.editor-instance:has([aria-label="Manage installed plugins"], ' +
        '[aria-label="Browse Marketplace"], [aria-label="浏览市场"], ' +
        'input[placeholder="Search or Paste Link"], input[placeholder="搜索或粘贴链接"], ' +
        'input[placeholder="Search skills, rules, subagents"], input[placeholder="搜索技能、规则与子智能体"])';

    function nodeHasMarketplace(node) {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
        try {
            return !!(node.closest && node.closest(MARKETPLACE_SELECTOR));
        } catch (e) { return false; }
    }

    function nodeHasBrowser(node) {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
        if (node.classList) {
            for (var i = 0; i < node.classList.length; i++) {
                var cls = node.classList[i];
                if (!cls) continue;
                if (cls.indexOf('browser-') >= 0 || cls.indexOf('simple-browser') >= 0) return true;
            }
        }
        try {
            return !!(node.closest && node.closest(
                '.browser-tools, .browser-navbar, .browser-tab, [class*="browser-tab"], ' +
                '[class*="browser-navbar"], [class*="browser-tools"], [class*="simple-browser"]'
            ));
        } catch (e) { return false; }
    }

    function nodeHasTimeline(node) {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
        try {
            return !!(node.closest && node.closest(
                '.timeline-tree-view, .timeline-view, [id="workbench.view.timeline"]'
            ));
        } catch (e) { return false; }
    }

    function inferNodeTaskFlags(node) {
        if (!node) return 0;
        var el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
        if (!el) return 0;
        var mask = 0;
        try {
            if (nodeHasCursorSettings(el)) mask |= TASK_SETTINGS | TASK_DROPDOWNS;
            if (nodeHasPromptBar(el)) mask |= TASK_COMPOSER;
            if (nodeHasMentionMenu(el)) mask |= TASK_COMPOSER;
            if (nodeHasContextMenu(el)) mask |= TASK_MENUS | TASK_EDITOR;
            if (nodeHasSelectionTools(el)) mask |= TASK_EDITOR;
            if (nodeHasCssInspector(el)) mask |= TASK_DESIGN;
            if (nodeHasNotification(el)) mask |= TASK_NOTIFICATIONS;
            if (nodeHasUIDialog(el)) mask |= TASK_DIALOGS;
            if (nodeHasMarketplace(el)) mask |= TASK_MARKETPLACE;
            if (nodeHasBrowser(el)) mask |= TASK_BROWSER;
            if (nodeHasTimeline(el)) mask |= TASK_TIMELINE;
            if (nodeHasMonacoHover(el)) mask |= TASK_HOVERS | TASK_DROPDOWNS;
            if (el.closest && el.closest('.statusbar, .part.statusbar, .statusbar-item, [id="workbench.parts.statusbar"]')) {
                mask |= TASK_HOVERS;
            }
            if (el.closest && el.closest('[class*="composer"], [class*="aichat"], [class*="agent-changes"], [class*="chat-input"]')) {
                mask |= TASK_COMPOSER;
            }
            if (el.closest && el.closest('.quick-input-widget, .monaco-quick-input')) mask |= TASK_MODELS | TASK_DROPDOWNS;
            if (el.closest && el.closest('[class*="index"], [class*="Index"], .pane-composite-part')) {
                mask |= TASK_INDEXING | TASK_CODEBASE;
            }
        } catch (e) {}
        return mask;
    }

    function collectBatchTaskFlags(nodes) {
        var mask = accumulatedTaskFlags;
        accumulatedTaskFlags = 0;
        for (var i = 0; i < nodes.length; i++) {
            mask |= inferNodeTaskFlags(nodes[i]);
        }
        return mask;
    }

    function runGlobalTranslationTasks(taskFlags) {
        var run = function(bit, fn) {
            if (taskFlags & bit) try { fn(); } catch (e) {}
        };
        run(TASK_INDEXING, localizeIndexingDescription);
        run(TASK_CODEBASE, localizeCodebaseDescription);
        run(TASK_MODELS, localizeModelSettings);
        run(TASK_SETTINGS, function() {
            localizeCursorSettings();
            localizeSettingsFragments();
            localizeAccountPlan();
            localizeHiddenDialogSettings();
        });
        run(TASK_BROWSER, function() {
            scheduleBrowserToolbarTranslation();
            localizeBrowserMenu();
            localizeBrowserErrors();
        });
        run(TASK_COMPOSER, function() {
            localizeComposerPlaceholders();
            localizeComposerToolbar();
            localizeEditorTitleTooltip();
            localizeQuickEdit();
            localizeChatInterface();
            localizeAgentChanges();
            localizeAgentFeedback();
            localizeThemeSelector();
            localizeQueuedMessages();
            localizeMentionMenu();
            localizeModelSelector();
            localizeAgentModes();
        });
        run(TASK_EDITOR, function() {
            localizeEditorSelection();
            localizeEditorContextMenu();
        });
        run(TASK_MENUS, localizeChatHistory);
        run(TASK_NOTIFICATIONS, function() {
            localizeUpgradePrompts();
            localizeFeaturePromotions();
            localizeNotifications();
        });
        run(TASK_DIALOGS, localizeUIDialogs);
        run(TASK_MARKETPLACE, localizeMarketplace);
        run(TASK_TIMELINE, localizeTimeline);
        run(TASK_DESIGN, function() {
            localizeShadowsAndBlur();
            localizeDesignPanel();
        });
        run(TASK_WELCOME, localizeWelcomeExtensions);
        run(TASK_DROPDOWNS, function() {
            localizeSettingsDropdowns();
            localizeDropdownPanels();
        });
        run(TASK_HOVERS, function() {
            translateMonacoHoverContent(document.body);
            translateCursorHoverWidget(document.body);
            localizeCommitScores();
        });
        try { localizeHiddenDialogSettings(); } catch (e) {}
        try { localizeCommitScores(); } catch (e) {}
    }

    function enqueueNode(node) {
        if (isEditorRegion(node)) return;
        pendingNodes.add(node);
        if (!isBatchScheduled) {
            isBatchScheduled = true;
            requestAnimationFrame(runBatchTranslation);
        }
    }

    function queueGlobalTranslation(taskFlags) {
        if (taskFlags === true) {
            mergeGlobalTaskFlags(TASK_ALL);
        } else if (typeof taskFlags === 'number' && taskFlags) {
            mergeGlobalTaskFlags(taskFlags);
        }
        if (!accumulatedTaskFlags) return;
        if (isGlobalTranslationQueued) {
            activeTaskFlags |= accumulatedTaskFlags;
            accumulatedTaskFlags = 0;
            return;
        }
        isGlobalTranslationQueued = true;
        var now = Date.now();
        var delay = now - lastGlobalTranslationTime < 1200 ? 1200 : 450;
        var scheduledTaskFlags = accumulatedTaskFlags;
        accumulatedTaskFlags = 0;
        setTimeout(function() {
            lastGlobalTranslationTime = Date.now();
            isGlobalTranslationQueued = false;
            var mask = scheduledTaskFlags | activeTaskFlags | accumulatedTaskFlags;
            activeTaskFlags = 0;
            accumulatedTaskFlags = 0;
            if (!mask) return;
            isBatchTranslationRunning = true;
            try { runGlobalTranslationTasks(mask); } catch (e) {}
            isBatchTranslationRunning = false;
            if (accumulatedTaskFlags || activeTaskFlags) queueGlobalTranslation();
        }, delay);
    }

    function runBatchTranslation() {
        var nodes = Array.from(pendingNodes);
        pendingNodes.clear();
        isBatchScheduled = false;
        isBatchTranslationRunning = true;
        try {
            for (var i = 0; i < nodes.length; i++) {
                try { translateSubtree(nodes[i]); } catch (e) {}
            }
        } finally {
            isBatchTranslationRunning = false;
        }
        var taskFlags = collectBatchTaskFlags(nodes);
        if (taskFlags) queueGlobalTranslation(taskFlags);
    }

    function nodeHasSelectionTools(node) {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
        if (node.classList && node.classList.contains('cursorHoverWidget')) return true;
        try { return !!(node.querySelector && node.querySelector('.cursorHoverWidget')); } catch (e) { return false; }
    }

    function nodeHasContextMenu(node) {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
        if (node.classList) {
            if (node.classList.contains('context-view') || node.classList.contains('monaco-menu') ||
                node.classList.contains('monaco-menu-container') || node.classList.contains('ui-menu') ||
                node.classList.contains('ui-menu__layout') || node.classList.contains('ui-menu__content') ||
                node.classList.contains('ui-slash-menu') || node.classList.contains('ui-slash-menu__content')) return true;
        }
        try {
            return !!(node.querySelector && node.querySelector(
                '.context-view .monaco-menu, .context-view [role="menu"], .monaco-menu-container, ' +
                '.ui-menu, .ui-menu__layout, .ui-menu__content, .ui-slash-menu, .ui-slash-menu__content'
            ));
        } catch (e) { return false; }
    }

    function nodeHasMenubar(node) {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
        if (node.classList) {
            if (node.classList.contains('menubar') ||
                node.classList.contains('menubar-menu-button') ||
                node.classList.contains('menubar-menu-title') ||
                node.classList.contains('titlebar')) return true;
        }
        try {
            return !!(node.closest && node.closest(
                '.menubar, [role="menubar"], .titlebar, .part.titlebar, .menubar-menu-button, .menubar-menu-title'
            ));
        } catch (e) { return false; }
    }

    function nodeHasMentionMenu(node) {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
        if (node.classList) {
            if (node.classList.contains('ui-slash-menu') || node.classList.contains('ui-slash-menu__content')) return true;
        }
        try {
            return !!(node.querySelector && node.querySelector('.ui-slash-menu, .ui-slash-menu__content'));
        } catch (e) { return false; }
    }

    function nodeHasCssInspector(node) {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
        if (node.classList) {
            for (var i = 0; i < node.classList.length; i++) {
                var cls = node.classList[i];
                if (cls && cls.indexOf('css-inspector') >= 0) return true;
                if (cls && cls.indexOf('css-effects') >= 0) return true;
                if (cls && cls.indexOf('css-effect') >= 0) return true;
            }
        }
        try {
            return !!(node.querySelector && node.querySelector(
                '.css-inspector-section, .css-effects-type-select, .css-effect-entry, [class*="css-inspector"]'
            ));
        } catch (e) { return false; }
    }

    function nodeHasMonacoHover(node) {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
        if (isTooltipNode(node)) return true;
        try {
            return !!(node.querySelector && node.querySelector(TOOLTIP_SELECTOR));
        } catch (e) { return false; }
    }

    function nodeHasPromptBar(node) {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
        if (node.classList) {
            for (var i = 0; i < node.classList.length; i++) {
                var cls = node.classList[i];
                if (!cls) continue;
                if (cls.indexOf('prompt-bar') >= 0 || cls.indexOf('pure-ai-prompt') >= 0 ||
                    cls.indexOf('ui-prompt-input') >= 0 || cls.indexOf('agent-prompt-input') >= 0 ||
                    cls === 'ProseMirror' || cls === 'inline-prompt-button-area') return true;
            }
        }
        try {
            return !!(node.querySelector && node.querySelector(
                '.pure-ai-prompt-bar, [class*="prompt-bar"], .ui-prompt-input, [class*="ui-prompt-input"], ' +
                '[class*="agent-prompt-input"], .ProseMirror, [data-placeholder]'
            ));
        } catch (e) { return false; }
    }

    function nodeHasUIDialog(node) {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
        if (node.classList) {
            for (var i = 0; i < node.classList.length; i++) {
                var cls = node.classList[i];
                if (cls && cls.indexOf('ui-dialog') >= 0) return true;
            }
        }
        try {
            return !!(node.querySelector && node.querySelector('.ui-dialog, .ui-alert-dialog, [class*="ui-dialog"]'));
        } catch (e) { return false; }
    }

    function nodeHasNotification(node) {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
        if (node.classList) {
            for (var i = 0; i < node.classList.length; i++) {
                var cls = node.classList[i];
                if (!cls) continue;
                if (cls.indexOf('notification') >= 0 || cls.indexOf('toast') >= 0 ||
                    cls.indexOf('promo') >= 0 || cls.indexOf('upsell') >= 0) return true;
            }
        }
        try {
            return !!(node.querySelector && node.querySelector(
                '.monaco-notification, [class*="notification-toast"], [class*="promo"], [class*="upsell"]'
            ));
        } catch (e) { return false; }
    }

    function nodeHasCursorSettings(node) {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
        if (node.classList) {
            for (var i = 0; i < node.classList.length; i++) {
                var cls = node.classList[i];
                if (cls && cls.indexOf('cursor-settings') >= 0) return true;
            }
        }
        try {
            return !!(node.querySelector && node.querySelector('[class*="cursor-settings"]'));
        } catch (e) { return false; }
    }

    function handleMutations(mutations) {
        var isProcessingBatch = isBatchTranslationRunning;
        var hasSelectionTools = false;
        var contextMenu = false;
        var hasMentionMenu = false;
        var promptBar = false;
        var monacoHover = false;
        var hasNotification = false;
        var hasUIDialog = false;
        var hasCursorSettings = false;
        var cssInspector = false;
        var hasMenubar = false;
        var mutationTaskFlags = 0;
        for (var i = 0; i < mutations.length; i++) {
            var m = mutations[i];
            if (m.type === 'childList') {
                var added = m.addedNodes;
                for (var j = 0; j < added.length; j++) {
                    var node = added[j];
                    var nodeTaskFlags = inferNodeTaskFlags(node);
                    if (nodeTaskFlags) {
                        mutationTaskFlags |= nodeTaskFlags;
                        if (isProcessingBatch) mergeGlobalTaskFlags(nodeTaskFlags);
                    }
                    if (!hasSelectionTools && nodeHasSelectionTools(node)) hasSelectionTools = true;
                    if (!contextMenu && nodeHasContextMenu(node)) contextMenu = true;
                    if (!hasMentionMenu && nodeHasMentionMenu(node)) hasMentionMenu = true;
                    if (!promptBar && nodeHasPromptBar(node)) promptBar = true;
                    if (!monacoHover && nodeHasMonacoHover(node)) monacoHover = true;
                    if (!hasNotification && nodeHasNotification(node)) hasNotification = true;
                    if (!hasUIDialog && nodeHasUIDialog(node)) hasUIDialog = true;
                    if (!hasCursorSettings && nodeHasCursorSettings(node)) hasCursorSettings = true;
                    if (!cssInspector && nodeHasCssInspector(node)) cssInspector = true;
                    if (!hasMenubar) {
                        var isMenubarNode = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
                        if (nodeHasMenubar(isMenubarNode)) hasMenubar = true;
                    }
                    if (!isProcessingBatch && (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE)) {
                        enqueueNode(node);
                    }
                }
            }
        }
        if (hasMenubar) {
            try { queueMenubarTranslation(); } catch (e) {}
        }
        if (hasSelectionTools) {
            try { localizeEditorSelection(); } catch (e) {}
        }
        if (contextMenu) {
            try { scheduleMenuTranslation(true); } catch (e) {}
            try { localizeEditorContextMenu(); } catch (e) {}
            try { localizeChatHistory(); } catch (e) {}
            setTimeout(function() {
                try { runMenuTranslation(); } catch (e) {}
            }, 1200);
        }
        if (monacoHover) {
            var hoverRoot = document.querySelector('.monaco-hover, .cursorHoverWidget, [role="tooltip"]');
            if (hoverRoot) {
                try { translateMonacoHoverContent(hoverRoot); } catch (e) {}
                try { translateCursorHoverWidget(hoverRoot); } catch (e) {}
            }
        }
        if (isProcessingBatch) return;
        if (hasMentionMenu) {
            try { scheduleMentionTranslation(); } catch (e) {}
        }
        if (promptBar) {
            try { scheduleMentionTranslation(); } catch (e) {}
            try { localizeQuickEdit(); } catch (e) {}
            try { localizeChatInterface(); } catch (e) {}
            try { localizeAgentChanges(); } catch (e) {}
            try { localizeAgentFeedback(); } catch (e) {}
            try { localizeThemeSelector(); } catch (e) {}
            try { localizeQueuedMessages(); } catch (e) {}
            try { localizeModelSelector(); } catch (e) {}
        }
        if (cssInspector) {
            try { localizeShadowsAndBlur(); } catch (e) {}
            try { localizeDesignPanel(); } catch (e) {}
        }
        if (promptBar || hasNotification) {
            try { localizeComposerPlaceholders(); } catch (e) {}
            try { localizeComposerToolbar(); } catch (e) {}
            try { localizeEditorTitleTooltip(); } catch (e) {}
        }
        if (hasNotification) {
            try { localizeNotifications(); } catch (e) {}
        }
        if (hasUIDialog) {
            try { localizeUIDialogs(); } catch (e) {}
        }
        if (hasCursorSettings) {
            try { localizeCursorSettings(); } catch (e) {}
            try { localizeSettingsFragments(); } catch (e) {}
            try { localizeHiddenDialogSettings(); } catch (e) {}
        }
        if (!isProcessingBatch && mutationTaskFlags) {
            var queuedTaskFlags = mutationTaskFlags;
            if (contextMenu) queuedTaskFlags &= ~(TASK_MENUS | TASK_EDITOR);
            if (hasSelectionTools) queuedTaskFlags &= ~TASK_EDITOR;
            if (promptBar || hasMentionMenu) queuedTaskFlags &= ~TASK_COMPOSER;
            if (monacoHover) queuedTaskFlags &= ~TASK_HOVERS;
            if (hasNotification) queuedTaskFlags &= ~TASK_NOTIFICATIONS;
            if (hasUIDialog) queuedTaskFlags &= ~TASK_DIALOGS;
            if (hasCursorSettings) queuedTaskFlags &= ~TASK_SETTINGS;
            if (cssInspector) queuedTaskFlags &= ~TASK_DESIGN;
            if (queuedTaskFlags) queueGlobalTranslation(queuedTaskFlags);
        }
    }

    function safelyRewriteText(el, text, needles) {
        if (!el || !text) return false;
        if (text.length > 400) return false;
        if (shouldSkipEditorElement(el)) return false;
        try {
            if (el.querySelector('input, textarea, select, button, [role="button"], [role="switch"], [contenteditable="true"]')) return false;
            var dropdowns = el.closest('[role="combobox"], .monaco-select-box, [class*="select-box"]');
            if (dropdowns && (el === dropdowns || el.childElementCount > 0)) return false;
            var hasMenu = el.closest(
                '.monaco-menu, .context-view, [role="menu"], [role="menubar"], ' +
                '.ui-menu, .ui-menu__content, .ui-slash-menu, [role="listbox"]'
            );
            if (hasMenu) {
                var isMenubarTitle = !!(el.classList && (
                    el.classList.contains('menubar-menu-title') ||
                    el.classList.contains('menubar-menu-button')
                )) || !!(el.closest && el.closest('.menubar-menu-title'));
                var clsName = el.className ? String(el.className) : '';
                var isLabel = !!(el.classList && (
                    el.classList.contains('action-label') ||
                    el.classList.contains('ui-menu__item-title') ||
                    el.classList.contains('ui-menu__item-content') ||
                    el.classList.contains('ui-menu__title') ||
                    el.classList.contains('text-dropdown-foreground') ||
                    clsName.indexOf('action-label') >= 0 ||
                    clsName.indexOf('ui-menu__item') >= 0
                ));
                var isLeaf = !el.querySelector || !el.querySelector('*');
                var isMenuItem = !!(el.closest && el.closest(
                    '[role="menuitem"], [role="option"], a.action-menu-item, li.action-item, ' +
                    '.ui-menu__row, .ui-menu__item, [class*="ui-menu__item"]'
                ));
                if (!isMenubarTitle && !isLabel && !(isLeaf && isMenuItem)) return false;
            }
        } catch (e) {}
        var parent = el.parentElement;
        if (parent) {
            var parentText = normalizeText(parent.textContent || '');
            if (parentText && parentText === text) return false;
        }
        el.textContent = text;
        return true;
    }

    var documentTextCache = { time: 0, text: '' };
    function getDocumentText() {
        var now = Date.now();
        if (now - documentTextCache.time < 600) return documentTextCache.text;
        var parts = [];
        try {
            function collectText(node) {
                if (!node) return;
                if (node.nodeType === 1) {
                    if (node.classList && node.classList.contains('monaco-editor')) return;
                    if (node.matches && node.matches('.monaco-editor')) return;
                }
                if (node.nodeType === 3) {
                    parts.push(node.textContent || '');
                    return;
                }
                var child = node.firstChild;
                while (child) {
                    if (child.nodeType === 1 && child.classList && child.classList.contains('monaco-editor')) {
                        child = child.nextSibling;
                        continue;
                    }
                    collectText(child);
                    child = child.nextSibling;
                }
            }
            if (document.body) collectText(document.body);
        } catch (e) {}
        var text = normalizeText(parts.join(' '));
        documentTextCache.time = now;
        documentTextCache.text = text;
        return text;
    }

    function documentContainsKeywords(words) {
        var text = getDocumentText();
        if (!text) return false;
        for (var i = 0; i < words.length; i++) {
            if (text.indexOf(words[i]) !== -1) return true;
        }
        return false;
    }

    function settingsContainKeywords(words) {
        var root = getSettingsRoot();
        if (!root) return false;
        var text = normalizeText(root.textContent || '');
        if (!text) return false;
        for (var i = 0; i < words.length; i++) {
            if (text.indexOf(words[i]) !== -1) return true;
        }
        return false;
    }

    function replaceTextNodeFragments(root, fragments) {
        if (!root || !fragments || !fragments.length) return false;
        if (root.nodeType === 1 && shouldSkipEditorElement(root)) return false;
        var changed = false;
        var walker;
        try {
            walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
        } catch (e) {
            return false;
        }

        var node;
        while ((node = walker.nextNode())) {
            if (isEditorRegion(node)) continue;
            try {
                if (node.parentElement && isMenuRegion(node.parentElement) && !isMenuTextNode(node)) continue;
            } catch (e) {}
            var neo = replaceFragments(node.textContent || '', fragments);
            if (neo && neo !== node.textContent) {
                node.textContent = neo;
                changed = true;
            }
        }
        return changed;
    }

    function localizeCodebaseDescription() {
        var settingsRoot = getSettingsRoot();
        if (!settingsRoot) return;
        if (!settingsHaveKeywordGroup('CODEBASE')) return;
        var fragments = [
            ['Embed codebase for improved contextual understanding and knowledge.', '嵌入代码库以提升上下文理解与知识检索。'],
            ['Embed codebase for improved contextual understanding and knowledge', '嵌入代码库以提升上下文理解与知识检索'],
            ['Embeddings and metadata are stored in the ', '嵌入向量和元数据存储在'],
            ['Embeddings and metadata are stored in ', '嵌入向量和元数据存储在'],
            [', but all code is stored locally.', '，但所有代码都存储在本地。'],
            ['but all code is stored locally.', '但所有代码都存储在本地。']
        ];
        translateSettingsFragments(settingsRoot, fragments, function(text) {
            return text.indexOf('Embed codebase for improved contextual understanding and knowledge') !== -1 ||
                text.indexOf('Embeddings and metadata are stored in') !== -1 ||
                (text.indexOf('嵌入代码库') !== -1 && text.indexOf('Embeddings and metadata') !== -1);
        });
    }

    function localizeIndexingDescription() {
        var settingsRoot = getSettingsRoot();
        if (!settingsRoot) return;
        if (!settingsHaveKeywordGroup('INDEXING')) return;
        translateSettingsTextRules(settingsRoot, [{
            test: function(text) {
                return text.indexOf('with fewer than 50,000 files') !== -1 ||
                    text.indexOf('index any new folders') !== -1 ||
                    text.indexOf('Automatically index any new folders') !== -1 ||
                    text.indexOf('自动matically') !== -1;
            },
            apply: function(el) {
                safelyRewriteText(el, '自动索引文件数少于 50,000 的新增文件夹', ['index any new folders', '50,000']);
            }
        }]);
    }

    function localizeModelSettings() {
        var settingsRoot = getSettingsRoot();
        if (!settingsRoot) return;
        if (!settingsHaveKeywordGroup('MODEL_SETTINGS')) return;
        translateSettingsTextRules(settingsRoot, [
            {
                test: function(text) { return text.indexOf('深度Seek V4 Pro') !== -1; },
                apply: function(el) {
                    if (!el.querySelector('div, span, p, label, button')) {
                        replaceTextNodeFragments(el, [['深度Seek V4 Pro', 'DeepSeek V4 Pro']]);
                    }
                }
            },
            {
                test: function(text) {
                    return text.indexOf('OpenAI key') !== -1 && text.indexOf('OpenAI models') !== -1;
                },
                apply: function(el) {
                    safelyRewriteText(el, '您可以填写自己的 OpenAI key 来按成本价使用 OpenAI 模型。', ['OpenAI key', 'OpenAI models']);
                }
            },
            {
                test: function(text) {
                    return text.indexOf('Anthropic key') !== -1 &&
                        (text.indexOf('beginning with') !== -1 || text.indexOf('"claude-"') !== -1);
                },
                apply: function(el) {
                    safelyRewriteText(el, '您可以填写自己的 Anthropic key 来按成本价使用 Claude。启用后，此 key 将用于所有以 "claude-" 开头的模型。', ['Anthropic key', 'claude-']);
                }
            },
            {
                test: function(text) {
                    return text.indexOf('于 cost') !== -1 && text.indexOf('Anthropic') !== -1;
                },
                apply: function(el) {
                    safelyRewriteText(el, '您可以填写自己的 Anthropic key 来按成本价使用 Claude。启用后，此 key 将用于所有以 "claude-" 开头的模型。', ['Anthropic key', 'claude-']);
                }
            },
            {
                test: function(text) {
                    return text.indexOf('于 cost') !== -1 ||
                        (text.indexOf('at-cost') !== -1 && text.indexOf('Google models') !== -1);
                },
                apply: function(el) {
                    safelyRewriteText(el, '您可以填写自己的 Google AI Studio key 来按成本价使用 Google 模型。', ['Google AI Studio key', 'Google models']);
                }
            },
            {
                test: function(text) {
                    return text.indexOf('Google AI Studio key') !== -1 && text.indexOf('Google models') !== -1;
                },
                apply: function(el) {
                    safelyRewriteText(el, '您可以填写自己的 Google AI Studio key 来按成本价使用 Google 模型。', ['Google AI Studio key', 'Google models']);
                }
            },
            {
                test: function(text) {
                    return text.indexOf('Configure Azure OpenAI') !== -1 && text.indexOf('Azure account') !== -1;
                },
                apply: function(el) {
                    safelyRewriteText(el, '配置 Azure OpenAI，通过您的 Azure 账户使用 OpenAI 模型。', ['Configure Azure OpenAI', 'Azure account']);
                }
            },
            {
                test: function(text) {
                    return text.indexOf('Configure AWS Bedrock') !== -1 && text.indexOf('AWS account') !== -1;
                },
                apply: function(el) {
                    safelyRewriteText(el, '配置 AWS Bedrock，通过您的 AWS 账户使用 Anthropic Claude 模型。', ['Configure AWS Bedrock', 'AWS account']);
                }
            },
            {
                test: function(text) {
                    return text.indexOf('Cursor Enterprise teams') !== -1 && text.indexOf('Access Keys') !== -1;
                },
                apply: function(el) {
                    safelyRewriteText(el, 'Cursor Enterprise 团队可配置 IAM 角色，无需任何 Access Keys 即可访问 Bedrock。', ['Cursor Enterprise teams', 'Access Keys']);
                }
            }
        ]);
    }

    function localizeUIDialogs() {
        if (!document.querySelector('.ui-dialog, .ui-alert-dialog, [class*="ui-dialog"]')) return;
        var hints = [
            ['Close Running Tab?', '关闭运行中的标签页？'],
            ['The chat is currently running. Are you sure you want to close it?', '对话正在运行中。确定要关闭吗？'],
            ['Discard all changes up to this checkpoint?', '放弃截至此检查点的所有更改？'],
            ['You can always undo this later.', '您随时都可以撤销此操作。'],
            ['You can always undo this later. Note: Notebook cells are not supported for reverting.', '您随时都可以撤销此操作。注意：Notebook 单元格不支持还原。'],
            ['This action cannot be undone.', '此操作无法撤销。'],
            ['This action cannot be undone', '此操作无法撤销'],
            ['Something went wrong.', '出错了。'],
            ['Something went wrong', '出错了'],
            ['An unexpected error occurred. Reload the window to try again.', '发生意外错误。请重新加载窗口后重试。'],
            ['Copy Error', '复制错误'],
            ["Don't ask again", '不再询问']
        ];
        var scopes = document.querySelectorAll('.ui-dialog, .ui-alert-dialog, [class*="ui-dialog"]');
        translateScopeListHints(scopes, hints, {
            maxLen: 240,
            needleLen: 12,
            selector: '.ui-dialog-title, .ui-dialog-description, .ui-alert-dialog-description, .ui-text, h1, h2, p, span, div',
            skipChildQuery: 'button, .ui-alert-dialog-action',
            allowTags: ['BUTTON']
        });
    }

    // 「关于」等 supplemental 辅助窗口：通过 window.open('about:blank') 创建，
    // CSP 为 script-src 'none'，主窗口 MutationObserver 无法覆盖，需跨文档翻译。
    var registeredAuxiliaryWindows = typeof WeakSet !== 'undefined' ? new WeakSet() : null;
    var auxiliaryWindows = [];

    function translateAuxiliaryText(raw) {
        if (!raw) return null;
        var trimmed = normalizeText(raw);
        if (!trimmed || !/[A-Za-z]/.test(trimmed)) return null;
        var tr = lookupTranslation(trimmed) || lookupTranslation(raw);
        if (tr && tr !== trimmed && tr !== raw) return tr;
        for (var i = 0; i < translationPatterns.length; i++) {
            var pair = translationPatterns[i];
            if (pair[0].test(trimmed)) {
                var neo = trimmed.replace(pair[0], pair[1]);
                if (neo && neo !== trimmed) return neo;
            }
        }
        return replacePartialText(trimmed);
    }

    function translateAuxiliaryDocument(doc) {
        if (!doc || !doc.body) return;
        try {
            var attrs = ['title', 'aria-label', 'placeholder', 'aria-placeholder'];
            var els = doc.querySelectorAll(
                'button, [role="button"], span, div, p, h1, h2, h3, label, a, ' +
                '[data-component^="glass-about-dialog"]'
            );
            for (var i = 0; i < els.length; i++) {
                var el = els[i];
                for (var a = 0; a < attrs.length; a++) {
                    var av = el.getAttribute(attrs[a]);
                    if (!av) continue;
                    var atr = translateAuxiliaryText(av);
                    if (atr && atr !== av) el.setAttribute(attrs[a], atr);
                }
                if (el.childElementCount > 0) {
                    // 仅翻译纯文本子节点，保留图标等元素
                    var nodes = el.childNodes;
                    for (var n = 0; n < nodes.length; n++) {
                        var tn = nodes[n];
                        if (!tn || tn.nodeType !== 3) continue;
                        var raw = tn.textContent || '';
                        var tr = translateAuxiliaryText(raw);
                        if (tr) {
                            var trimmed = raw.trim();
                            var idx = raw.indexOf(trimmed);
                            if (idx < 0) tn.textContent = tr;
                            else tn.textContent = raw.substring(0, idx) + tr + raw.substring(idx + trimmed.length);
                        }
                    }
                    continue;
                }
                var text = el.textContent || '';
                var ttr = translateAuxiliaryText(text);
                if (ttr) {
                    var ttrim = text.trim();
                    var tidx = text.indexOf(ttrim);
                    if (tidx < 0) el.textContent = ttr;
                    else el.textContent = text.substring(0, tidx) + ttr + text.substring(tidx + ttrim.length);
                }
            }
        } catch (e) {}
    }

    function registerAuxiliaryWindow(win, features) {
        if (!win) return;
        try {
            if (registeredAuxiliaryWindows) {
                if (registeredAuxiliaryWindows.has(win)) return;
                registeredAuxiliaryWindows.add(win);
            } else if (auxiliaryWindows.indexOf(win) >= 0) {
                return;
            } else {
                auxiliaryWindows.push(win);
            }
        } catch (e) {}

        var obs = null;
        var timer = null;
        var ticks = 0;

        function runAuxiliaryTranslation() {
            try {
                if (!win || win.closed) {
                    if (timer) clearInterval(timer);
                    if (obs) try { obs.disconnect(); } catch (e2) {}
                    return;
                }
                translateAuxiliaryDocument(win.document);
            } catch (e3) {}
        }

        function installAuxiliaryObserver() {
            try {
                if (!win.document || !win.document.documentElement) return false;
                if (obs) return true;
                obs = new MutationObserver(function() { runAuxiliaryTranslation(); });
                obs.observe(win.document.documentElement, {
                    childList: true,
                    subtree: true,
                    characterData: true,
                    attributes: true,
                    attributeFilter: ['aria-label', 'title', 'disabled']
                });
                runAuxiliaryTranslation();
                return true;
            } catch (e4) {
                return false;
            }
        }

        try {
            if (win.document && win.document.readyState === 'complete') installAuxiliaryObserver();
            else if (win.addEventListener) win.addEventListener('load', function() { installAuxiliaryObserver(); runAuxiliaryTranslation(); });
        } catch (e5) {}

        timer = setInterval(function() {
            ticks++;
            installAuxiliaryObserver();
            runAuxiliaryTranslation();
            try {
                if (ticks > 60 || !win || win.closed) clearInterval(timer);
            } catch (e6) {
                clearInterval(timer);
            }
        }, 100);
    }

    function installAuxiliaryWindowTranslation() {
        if (window.__cursorZhAuxiliaryOpenPatched) return;
        window.__cursorZhAuxiliaryOpenPatched = true;
        var originalOpen = window.open;
        if (typeof originalOpen !== 'function') return;
        window.open = function(url, name, features) {
            var ret = originalOpen.apply(this, arguments);
            try {
                var win = ret && ret.window ? ret.window : ret;
                if (win) registerAuxiliaryWindow(win, features);
            } catch (e) {}
            return ret;
        };
    }

    function installPlaceholderHook() {
        if (window.__cursorZhPlaceholderHooked) return;
        window.__cursorZhPlaceholderHooked = true;
        try {
            var originalSetAttribute = Element.prototype.setAttribute;
            if (typeof originalSetAttribute === 'function') {
                Element.prototype.setAttribute = function(name, value) {
                    if (typeof value === 'string' && value.length > 0 && typeof name === 'string') {
                        var lower = name.toLowerCase();
                        if (lower === 'data-placeholder' || lower === 'placeholder' || lower === 'aria-placeholder') {
                            var tr = lookupTranslation(value) || replacePartialText(value);
                            if (tr && tr !== value) value = tr;
                        }
                    }
                    return originalSetAttribute.call(this, name, value);
                };
            }
        } catch (e) {}
    }
    try { installPlaceholderHook(); } catch (e) {}

    function localizeNotifications() {
        var roots = document.querySelectorAll(
            '.monaco-notification, .notifications-list-container, .notification-list-item, ' +
            '[class*="notification-toast"], [class*="notification-toast-item"], [class*="promo"], ' +
            '[class*="upsell"], [class*="feature-card"], [class*="toast-container"]'
        );
        var scopes = roots.length ? Array.prototype.slice.call(roots) : [document.body];
        translateScopeDictionary(scopes, {
            maxLen: 600,
            needleLen: 14,
            skipHoverWidget: true,
            skipNestedInteractive: true
        });
    }

    function localizeFeaturePromotions() {
        if (!documentHasKeywordGroup('FEATURE_PROMOTIONS')) return;
        var hints = [
            ["You've hit your usage limit", '您已达到用量上限'],
            ['Usage limit reached', '已达用量上限'],
            ['Total usage limit reached', '已达到总用量上限'],
            ["You've reached your monthly limit. Set a new on-demand limit to continue.", '您已达到本月用量上限。请设置新的按需用量限额以继续使用。'],
            ["You've reached your monthly limit. Set a new on-demand limit to continue", '您已达到本月用量上限。请设置新的按需用量限额以继续使用'],
            ["You've reached your limit. Responses may be slower. Upgrade for more usage.", '您已达到用量上限。响应可能会变慢。升级以获取更多用量。'],
            ["You've reached your limit. Responses may be slower. Upgrade to Pro+ for 3x more usage.", '您已达到用量上限。响应可能会变慢。升级到 Pro+ 可获得 3 倍用量。'],
            ['Get faster responses', '获得更快响应'],
            ['Increase limits for faster responses', '提高限额以获得更快响应'],
            ["You're out of usage. Switch to Auto, or ask your admin to increase your limit to continue.", '您的用量已用尽。请切换到自动，或联系管理员提高限额以继续使用。'],
            ['Upgrade to Pro+', '升级到 Pro+'],
            ['Set new limit', '设置新限额'],
            ["Cursor's Smartest Model Yet", 'Cursor 迄今最智能的模型'],
            ['Trained jointly with SpaceXAI, Grok 4.5 can handle long-running tasks beyond coding', '与 SpaceXAI 联合训练，Grok 4.5 可处理超出编码范围的长时任务'],
            ['50% Off Through July 14', '7 月 14 日前五折优惠'],
            ['Get double the usage for the first week across desktop, web, iOS, CLI, and SDK', '首周在桌面端、网页、iOS、CLI 和 SDK 上享双倍用量'],
            ['Try Grok 4.5', '试用 Grok 4.5'],
            ['Extending 50% Off Cursor Grok 4.5', '延长 Cursor Grok 4.5 五折优惠'],
            ["We're extending the Cursor Grok 4.5 promotion for another week. Enjoy double usage through July 21 across desktop, web, iOS, CLI, and our SDK.", '我们将 Cursor Grok 4.5 促销活动再延长一周。截至 7 月 21 日，在桌面端、网页、iOS、CLI 和 SDK 上享双倍用量。'],
            ['2x Included Usage', '2 倍包含用量'],
            ['Your plan now includes 2x usage for all Cursor models: Composer 2.5 and Cursor Grok 4.5.', '您的套餐现包含所有 Cursor 模型 2 倍用量：Composer 2.5 和 Cursor Grok 4.5。'],
            ['Plan Update', '计划更新'],
            ['High Load', '高负载'],
            ["We're experiencing high demand for Cursor Grok 4.5 right now. Please switch to Auto, another model, or try again in a few moments.", '当前 Cursor Grok 4.5 需求量很大。请切换到 Auto、其他模型，或稍后再试。'],
            ["We're experiencing high demand right now. Please upgrade to Pro or try again in a few moments.", '当前需求量很大。请升级到专业版，或稍后再试。'],
            ["We're experiencing high demand right now. Please try again in a few moments.", '当前需求量很大。请稍后再试。'],
            ['Plugins, MCPs, Skills, and Rules have moved to Customize', '插件、MCP、技能和规则已移至「自定义」'],
            ["We've introduced a new home for all the ways to customize Cursor.", '我们为 Cursor 的各种自定义方式提供了新入口。'],
            ['Connection failed', '连接失败'],
            ['Connect GitHub to Cursor', '将 GitHub 连接到 Cursor'],
            ['Let agents work with your Repos', '让智能体使用您的仓库'],
            ['Run durable, parallel agents in the cloud, automate code review with Bugbot, and steer agents from your phone.', '在云端运行持久、并行的智能体，用 Bugbot 自动审查代码，并在手机上操控智能体。'],
            ['Extension host terminated unexpectedly 3 times within the last 5 minutes.', '扩展宿主在过去 5 分钟内意外终止了 3 次。'],
            ['Restart Extension Host', '重启扩展宿主'],
            ['Start Extension Bisect', '启动扩展二分排查'],
            ['Get Cursor Pro for more Agent usage, unlimited Tab, and more.', '升级到 Cursor Pro 以获取更多 Agent 用量、无限 Tab 等。'],
            ['Get Cursor Pro for more Agent usage, unlimited Tab, and more', '升级到 Cursor Pro 以获取更多 Agent 用量、无限 Tab 等。'],
            ['Get Cursor Pro for more Agent usage, Cloud Agents, and more.', '升级到 Cursor Pro 以获取更多智能体用量、云端智能体等。'],
            ['Get Cursor Pro for more Agent usage, Cloud Agents, and more', '升级到 Cursor Pro 以获取更多智能体用量、云端智能体等。'],
            ['Use /multitask', '使用 /multitask'],
            ['Parallelize Your Work', '并行处理工作'],
            ['Get Unblocked', '解除等待阻塞'],
            ['Run async subagents to parallelize your requests instead of adding them to the queue', '运行异步子智能体并行处理请求，而不是加入队列等待'],
            ['Ask Cursor to multitask on queued messages instead of waiting for the run to finish', '让 Cursor 对队列中的消息进行多任务处理，无需等待当前运行结束'],
            ['Tell Cursor to use subagents to break down tasks, do work in parallel, and preserve context', '让 Cursor 使用子智能体拆分任务、并行处理工作并保留上下文'],
            ['Try now in Cursor 3', '在 Cursor 3 中立即试用'],
            ['Try Now in Cursor 3', '在 Cursor 3 中立即试用'],
            ['Coordinate parallel tasks...', '协调并行任务...'],
            ['Refactor code generator', '重构代码生成器'],
            ['Add tabs to leaderboard', '为排行榜添加标签页'],
            ['Implement navigation menu', '实现导航菜单']
        ];
        translateElementListSubstrings(
            document.querySelectorAll('div, span, p, button, label, li, option'),
            hints,
            { skipEditor: true, skipDictionary: true, needleLen: 16 }
        );
    }

    function localizeWelcomeExtensions() {
        if (!documentHasKeywordGroup('WELCOME')) return;
        var hints = [
            ['Sign in', '登录'],
            ['Log in', '登录'],
            ['Sign Up', '注册'],
            ['Sign up', '注册'],
            ['The best way to code with AI', '与 AI 协作编程的最佳方式'],
            ['Log in to use Cursor AI features', '登录以使用 Cursor AI 功能'],
            ['Open Project', '打开项目'],
            ['Clone Repository', '克隆仓库'],
            ['Connect via SSH', '通过 SSH 连接'],
            ['Remote Machines', '远程计算机'],
            ['Search Remote Machines...', '搜索远程计算机...'],
            ['No remote machines yet.', '暂无远程计算机。'],
            ['Run on', '运行于'],
            ['Publish to GitHub', '发布到 GitHub'],
            ['No git repository found.', '未找到 Git 仓库。'],
            ['Report Issue', '报告问题'],
            ['Send Feedback', '发送反馈'],
            ['Code Intelligence', '代码智能'],
            ['Repositories', '仓库'],
            ['Browse Files', '浏览文件'],
            ['Message Cursor', '向 Cursor 发送消息'],
            ["Let's kick something off", '让我们开始吧'],
            ['No workspace folder open', '未打开工作区文件夹'],
            ['Close Pane', '关闭窗格'],
            ['Lock Group', '锁定组'],
            ['Unable to load automations.', '无法加载自动化。'],
            ['Unable to load automations', '无法加载自动化'],
            ['Author', '作者'],
            ['Inactive', '未激活'],
            ['Untitled', '未命名'],
            ['Edit Details', '编辑详情'],
            ['Duplicate', '创建副本'],
            ['Copy as JSON', '复制为 JSON'],
            ['Triggers', '触发器'],
            ['Add Trigger', '添加触发器'],
            ['Select repository', '选择仓库'],
            ['Test run', '测试运行'],
            ['Memories', '记忆'],
            ['Extend Cursor with Plugins', '通过插件扩展 Cursor'],
            ['Search Plugins for User...', '搜索用户插件...'],
            ['Search Plugins, Skills, MCPs...', '搜索插件、技能、MCP...'],
            ['Browse 市场', '浏览市场'],
            ['Open Plugins', '打开插件'],
            ['Open MCPs', '打开 MCP'],
            ['Open Skills', '打开技能'],
            ['Recent Workspaces', '最近工作区'],
            ['Teach Cursor New Skills', '教 Cursor 新技能'],
            ['Skills package domain-specific knowledge and workflows that Agent applies automatically when relevant.', '技能将领域特定的知识和工作流打包，智能体在相关时会自动应用。'],
            ['Getting Started', '开始使用'],
            ['Last Used Windows', '上次使用的窗口'],
            ['Window Restoration', '窗口还原'],
            ['Extensions have been modified on disk. Please reload the window.', '扩展已在磁盘上被修改。请重新加载窗口。'],
            ['Background agents only work in folders with a git repository. Please open a folder that contains a git repository to use this feature.', '后台智能体仅在包含 Git 仓库的文件夹中可用。请打开包含 Git 仓库的文件夹以使用此功能。'],
            ['Please open a folder to use background agents.', '请打开文件夹以使用后台智能体。'],
            ['Please open a folder to use background agents', '请打开文件夹以使用后台智能体'],
            ['Click to import all local VS Code extensions', '点击以导入所有本地 VS Code 扩展'],
            ['Click to import all local VS Code extensions.', '点击以导入所有本地 VS Code 扩展。'],
            ["(don't show again)", '（不再显示）'],
            ["don't show again", '不再显示'],
            ["Don't show again", '不再显示']
        ];
        translateElementListHints(
            document.querySelectorAll(
                'a, button, span, div, p, label, [role="button"], [role="link"], .monaco-hover, [role="tooltip"]'
            ),
            hints,
            { maxLen: 160, needleLen: 12, leafOnly: true }
        );
    }

    function localizeShadowsAndBlur() {
        if (!documentHasKeywordGroup('SHADOWS_AND_BLUR') && !document.querySelector(
            '.css-inspector-section, .css-effects-type-select, .css-effect-entry, [class*="css-inspector"]'
        )) return;
        var hints = [
            ['Drop shadow', '外阴影'],
            ['Inner shadow', '内阴影'],
            ['Layer Blur', '图层模糊'],
            ['Backdrop Blur', '背景模糊'],
            ['Add shadow or blur', '添加阴影或模糊'],
            ['Remove shadow', '移除阴影'],
            ['Remove blur', '移除模糊'],
            ['Adjust shadow', '调整阴影'],
            ['Adjust blur', '调整模糊'],
            ['Hide drop shadow', '隐藏外阴影'],
            ['Show drop shadow', '显示外阴影'],
            ['Hide inner shadow', '隐藏内阴影'],
            ['Show inner shadow', '显示内阴影'],
            ['Hide layer blur', '隐藏图层模糊'],
            ['Show layer blur', '显示图层模糊'],
            ['Hide backdrop blur', '隐藏背景模糊'],
            ['Show backdrop blur', '显示背景模糊']
        ];
        var scopes = document.querySelectorAll(
            '.css-inspector-section, .css-effect-entry, .css-effects-type-select, ' +
            '.css-section-title, .css-section-actions, .css-section-body, ' +
            'select.css-effects-type-select option, .monaco-hover, .monaco-hover-content, [role="tooltip"]'
        );
        var scopeList = scopes.length ? Array.prototype.slice.call(scopes) : [document.body];
        translateScopeListHints(scopeList, hints, {
            maxLen: 120,
            needleLen: 12,
            selector: 'span, div, button, label, li, option, select, [role="option"], [role="menuitem"], p'
        });
        try { translateMonacoHoverContent(document.body); } catch (e) {}
    }

    function localizeDesignPanel() {
        if (!documentHasKeywordGroup('DESIGN_PANEL') && !document.querySelector('.css-inspector-section, .css-effects-type-select')) {
            return;
        }
        try { localizeShadowsAndBlur(); } catch (e) {}
        var hints = [
            ['Solid', '纯色'],
            ['Linear', '线性'],
            ['Radial', '径向'],
            ['Conic', '锥形'],
            ['Circle', '圆形'],
            ['Ellipse', '椭圆'],
            ['Stops', '色标'],
            ['Fixed Width', '固定宽度'],
            ['Fit contents', '适应内容'],
            ['Fill container', '填充容器'],
            ['Add Min Width', '添加最小宽度'],
            ['Add Max Width', '添加最大宽度'],
            ['Drop shadow', '外阴影'],
            ['Inner shadow', '内阴影'],
            ['Layer Blur', '图层模糊'],
            ['Backdrop Blur', '背景模糊'],
            ['Add shadow or blur', '添加阴影或模糊'],
            ['Remove shadow', '移除阴影'],
            ['Remove blur', '移除模糊'],
            ['Adjust shadow', '调整阴影'],
            ['Adjust blur', '调整模糊']
        ];
        var roots = document.querySelectorAll(
            '.css-inspector-section div, .css-inspector-section span, .css-inspector-section button, ' +
            '.css-inspector-section label, .css-inspector-section li, .css-inspector-section option, ' +
            '.css-inspector-section select, div, span, button, label, li, option, [role="option"], [role="menuitem"]'
        );
        translateElementListHints(roots, hints, { maxLen: 80, needleLen: 12, leafOnly: true });
    }

    function localizeUpgradePrompts() {
        if (!documentHasKeywordGroup('UPGRADE_PROMPTS')) return;
        var hints = [
            ["You've hit your usage limit", '您已达到用量上限'],
            ["You're approaching your usage limit", '您的用量即将达到上限'],
            ['Usage limit reached', '已达用量上限'],
            ['Total usage limit reached', '已达到总用量上限'],
            ["You've reached your monthly limit. Set a new on-demand limit to continue.", '您已达到本月用量上限。请设置新的按需用量限额以继续使用。'],
            ["You've reached your monthly limit. Set a new on-demand limit to continue", '您已达到本月用量上限。请设置新的按需用量限额以继续使用'],
            ["You've reached your limit. Responses may be slower. Upgrade for more usage.", '您已达到用量上限。响应可能会变慢。升级以获取更多用量。'],
            ["You've reached your limit. Responses may be slower. Upgrade to Pro+ for 3x more usage.", '您已达到用量上限。响应可能会变慢。升级到 Pro+ 可获得 3 倍用量。'],
            ['Get faster responses', '获得更快响应'],
            ['Increase limits for faster responses', '提高限额以获得更快响应'],
            ["You're out of usage. Switch to Auto, or ask your admin to increase your limit to continue.", '您的用量已用尽。请切换到自动，或联系管理员提高限额以继续使用。'],
            ['Upgrade to Pro+', '升级到 Pro+'],
            ['Set new limit', '设置新限额'],
            ['Get Cursor Pro for more Agent usage, unlimited Tab, and more.', '升级到 Cursor Pro 以获取更多 Agent 用量、无限 Tab 等。'],
            ['Get Cursor Pro for more Agent usage, unlimited Tab, and more', '升级到 Cursor Pro 以获取更多 Agent 用量、无限 Tab 等。'],
            ['Get Cursor Pro for more Agent usage, Cloud Agents, and more.', '升级到 Cursor Pro 以获取更多智能体用量、云端智能体等。'],
            ['Get Cursor Pro for more Agent usage, Cloud Agents, and more', '升级到 Cursor Pro 以获取更多智能体用量、云端智能体等。'],
            ['Upgrade for extended limits and full model access', '升级以获取扩展限额和完整模型访问权限'],
            ['Upgrade for extended usage & faster responses', '升级以获取扩展用量和更快响应'],
            ['Upgrade for 3x usage & faster responses', '升级以获取 3 倍用量和更快响应'],
            ['Upgrade to a Pro account', '升级到专业版账户'],
            ['Upgrade to Pro', '升级到专业版'],
            ['Included Usage', '包含用量'],
            ['Plan Update', '计划更新'],
            ['Window Restoration', '窗口还原'],
            ['Last Used Windows', '上次使用的窗口'],
            ['Controls which windows Cursor restores on startup', '控制启动时 Cursor 还原哪些窗口'],
            ['Play a sound when agents finish or need attention', '当智能体完成或需要关注时播放提示音'],
            ['Cursor Models', 'Cursor 模型'],
            ['Other Models', '其他模型'],
            ['Default Model', '默认模型'],
            ['Cursor Default', 'Cursor 默认'],
            ['No commit has been scored yet', '尚未对任何提交评分'],
            ['No commit scored', '暂无已评分提交'],
            ['Agent AI Stats (Today):', '智能体 AI 统计（今日）：'],
            ['Agent Stats:', '智能体统计：'],
            ['Tab AI Stats (Today):', 'Tab AI 统计（今日）：'],
            ['Tab Stats:', 'Tab 统计：'],
            ['Search Cursor settings...', '搜索 Cursor 设置...']
        ];
        translateElementListSubstrings(
            document.querySelectorAll('.monaco-hover, .monaco-hover-content, .upgrade-pro-button, .glass-sidebar-upgrade-pro-cta, div, span, p'),
            hints,
            { skipEditor: true, needleLen: 16 }
        );
    }

    function updatePlaceholderAttribute(root) {
        if (!root) return;
        var nodes = root.querySelectorAll(
            '[data-placeholder], [aria-placeholder], input[placeholder], textarea[placeholder]'
        );
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            if (node.closest('.monaco-editor .view-lines')) continue;
            var attrs = ['placeholder', 'data-placeholder', 'aria-placeholder'];
            for (var a = 0; a < attrs.length; a++) {
                var ph = node.getAttribute(attrs[a]);
                if (!ph) continue;
                var tr = lookupTranslation(ph) || replacePartialText(ph);
                if (tr && tr !== ph) node.setAttribute(attrs[a], tr);
            }
        }
    }

    function translatePromptBarText(el, maxLen) {
        if (isProtectedContent(el)) return false;
        if (!el || !isPromptBarRegion(el)) return false;
        if (el.closest('.monaco-editor .view-lines')) return false;
        maxLen = maxLen || 120;
        var raw = (el.textContent || '').trim();
        if (!raw || raw.length > maxLen) return false;
        if (el.classList && el.classList.contains('prompt-bar-dropdown-shortcut')) return false;
        var tr = lookupTranslation(raw) || replacePartialText(raw);
        if (!tr) {
            var hints = [
                ['Edit selected code', '编辑所选代码'],
                ['Ask quick question', '快速提问'],
                ['Edit Selection', '编辑选区'],
                ['Quick Question', '快速提问'],
                ['Send', '发送'],
                ['Send to Chat', '发送到聊天'],
                ['Send to chat', '发送到聊天']
            ];
            for (var h = 0; h < hints.length; h++) {
                if (raw === hints[h][0]) { tr = hints[h][1]; break; }
            }
        }
        if (tr && tr !== raw) {
            el.textContent = tr;
            return true;
        }
        return false;
    }

    function translatePromptBarTextNode(node) {
        if (isProtectedContent(node)) return ;
        if (!node || node.nodeType !== Node.TEXT_NODE) return;
        var parent = node.parentElement;
        if (!parent || !isPromptBarRegion(parent)) return;
        if (parent.closest('.monaco-editor .view-lines')) return;
        var text = node.textContent;
        if (!text) return;
        var trimmed = text.trim();
        if (!trimmed || trimmed.length > 120) return;
        var tr = lookupTranslation(trimmed) || lookupTranslation(text);
        if (!tr) {
            if (trimmed === 'Edit selected code') tr = '编辑所选代码';
            else if (trimmed === 'Edit Selection') tr = '编辑选区';
            else if (trimmed === 'Send') tr = '发送';
            else if (trimmed === 'Ask quick question') tr = '快速提问';
            else if (trimmed === 'Quick Question') tr = '快速提问';
        }
        if (!tr || tr === trimmed) return;
        var prefix = text.substring(0, text.indexOf(trimmed));
        var suffix = text.substring(text.indexOf(trimmed) + trimmed.length);
        node.textContent = prefix + tr + suffix;
    }

    function runPromptBarTranslation() {
        var roots = getPromptBarRoot();
        if (!roots.length) {
            var cw = document.querySelector('.contentWidgets, .overlayWidgets');
            if (!cw) return;
            roots = [cw];
        }
        for (var ri = 0; ri < roots.length; ri++) {
            var root = roots[ri];
            if (root.closest('.monaco-editor .view-lines')) continue;
            updatePlaceholderAttribute(root);
            translateAttributes(root);
            var phEls = root.querySelectorAll(
                '.ProseMirror, .tiptap, [contenteditable="true"], [data-placeholder], ' +
                '.prompt-edit-input, [class*="prompt-edit-input"]'
            );
            for (var pi = 0; pi < phEls.length; pi++) {
                updatePlaceholderAttribute(phEls[pi]);
                translateAttributes(phEls[pi]);
            }
            try {
                var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
                var tnode;
                while ((tnode = walker.nextNode())) translatePromptBarTextNode(tnode);
            } catch (e) {}
            var leaves = root.querySelectorAll(
                'span, div, button, label, a, p, .ProseMirror p.is-editor-empty, ' +
                '.prompt-bar-dropdown-trigger, [class*="prompt-barmode"], [class*="prompt-bar-dropdown"], ' +
                '.inline-prompt-button-area *'
            );
            for (var li = 0; li < leaves.length; li++) {
                var el = leaves[li];
                if (el.closest('.monaco-editor .view-lines')) continue;
                translateAttributes(el);
                if (!el.querySelector('span, div, button')) translatePromptBarText(el, 80);
            }
        }
        try { translateMentionMenu(); } catch (e) {}
        translateMonacoHoverContent(document.body);
    }

    function localizeQuickEdit() {
        runPromptBarTranslation();
        if (!window.__cursorZhPromptBarObserver) {
            window.__cursorZhPromptBarObserver = true;
            var promptBarTimer = null;
            var obs = new MutationObserver(function() {
                if (isBatchTranslationRunning) return;
                if (!getPromptBarRoot().length &&
                    !document.querySelector('.contentWidgets .pure-ai-prompt-bar')) return;
                if (promptBarTimer) clearTimeout(promptBarTimer);
                promptBarTimer = setTimeout(function() {
                    promptBarTimer = null;
                    try { runPromptBarTranslation(); } catch (e) {}
                }, 120);
            });
            obs.observe(document.body, { childList: true, subtree: true, characterData: true });
        }
    }

    function localizeModelSelector() {
        var attrHints = [
            ['Switch Model', '切换模型'],
            ['Switch to Auto', '切换到自动'],
            ['Switch Model and Retry', '切换模型并重试']
        ];
        var picks = document.querySelectorAll(
            '[class*="model-picker"] button, [class*="model-picker"] [role="button"], ' +
            '[class*="model-picker"] [title], [class*="model-picker"] [aria-label]'
        );
        for (var i = 0; i < picks.length; i++) updateAttributeHints(picks[i], attrHints);
        localizeDropdownPanels();
        var hovers = document.querySelectorAll('.monaco-hover, .monaco-hover-content, [role="tooltip"]');
        for (var h = 0; h < hovers.length; h++) {
            var ht = hovers[h];
            if (ht.closest('.monaco-editor .view-lines')) continue;
            updateAttributeHints(ht, attrHints);
            replaceTextNodeFragments(ht, DROPDOWN_FRAGMENTS);
        }
    }

    function localizeChatInterface() {
        var attrHints = CHAT_COMMON_HINTS.concat(
            MENTION_MENU_HINTS,
            AGENT_CHANGE_COMMON_HINTS,
            AGENT_CHANGE_ATTRIBUTE_HINTS,
            CHAT_ATTRIBUTE_HINTS
        );
        var textHints = CHAT_COMMON_HINTS.concat(
            MENTION_MENU_HINTS,
            AGENT_CHANGE_COMMON_HINTS,
            AGENT_CHANGE_PENDING_HINTS,
            CHAT_TEXT_HINTS,
            COMMON_MENU_HINTS
        );
        try { translateMentionMenu(); } catch (e) {}
        var btns = document.querySelectorAll(
            '[class*="composer"] button, [class*="chat-input"] button, [class*="aichat"] button, ' +
            '[class*="composer"] [role="button"], [class*="model-picker"] button, [class*="model-picker"] [role="button"], ' +
            '[class*="agent-changes"] button, [class*="agent-changes"] [role="button"], [class*="pending-changes"] button, ' +
            '[class*="review-control"] button, [class*="changes-header"] button, ' +
            '.context-view button, .monaco-menu .action-label'
        );
        for (var b = 0; b < btns.length; b++) updateAttributeHints(btns[b], attrHints);
        translateMonacoHoverContent(document.body);
        var scopes = document.querySelectorAll(
            '[class*="context-usage"], [class*="contextUsage"], [class*="composer"] div, ' +
            '[class*="agent-changes"], [class*="AgentChanges"], [class*="pending-changes"], [class*="review-control"], ' +
            '[class*="changes-header"], [class*="diff-against"], ' +
            '.context-view, .monaco-menu, [role="menu"], [role="menuitem"], ' +
            '.ui-menu, .ui-slash-menu, .ui-slash-menu__content'
        );
        var scopeList = scopes.length ? Array.prototype.slice.call(scopes) : [document.body];
        translateScopeListHints(scopeList, textHints, {
            maxLen: 80,
            needleLen: 12,
            selector: 'span, div, label, button, a, li'
        });
    }

    function localizeThemeSelector() {
        var widget = document.querySelector('.quick-input-widget, .monaco-quick-input');
        if (!widget) return;
        var titleEl = widget.querySelector('.quick-input-title');
        if (titleEl) {
            var titleText = normalizeText(titleEl.textContent || '');
            if (titleText && titleText.length <= 120) {
                var titleTr = lookupTranslation(titleText);
                if (titleTr && titleTr !== titleText) {
                    safelyRewriteText(titleEl, titleTr, [titleText.slice(0, 12)]);
                }
            }
        }
        var rows = widget.querySelectorAll('.quick-input-list .monaco-list-row');
        for (var i = 0; i < rows.length; i++) {
            var walker = document.createTreeWalker(rows[i], NodeFilter.SHOW_TEXT, null);
            var node;
            while ((node = walker.nextNode())) {
                var text = node.textContent;
                if (!text) continue;
                var trimmed = text.trim();
                if (!trimmed || trimmed.length > 80) continue;
                if (isTranslatedThemeName(trimmed)) continue;
                var tr = lookupTranslation(trimmed);
                if (!tr || tr === trimmed) continue;
                var prefix = text.substring(0, text.indexOf(trimmed));
                var suffix = text.substring(text.indexOf(trimmed) + trimmed.length);
                node.textContent = prefix + tr + suffix;
            }
        }
    }

    function localizeAgentFeedback() {
        var hints = [
            ['How did the agent do?', '智能体表现如何？'],
        ['Response A is Better', '回复 A 更好'],
        ['Response B is Better', '回复 B 更好'],
            ['Did the agent understand what you wanted?', '智能体是否理解您的需求？'],
            ['Misunderstood task', '误解了任务'],
            ['Ignored constraint', '忽略了约束'],
            ['Wrong scope', '范围不对'],
            ['Was the response easy to read and use?', '回复是否易于阅读和使用？'],
            ['Visually hard to read', '视觉上难以阅读'],
            ['Wrote too much', '写得过多'],
            ['Explanation not trustworthy', '解释不可信'],
            ['Anything else?', '还有其他反馈吗？'],
            ['Add a comment...', '添加评论...'],
            ['Add a comment', '添加评论'],
            ['None', '无']
        ];
        if (!documentHasKeywordGroup('AGENT_FEEDBACK')) return;
        var scopes = document.querySelectorAll(
            '[class*="feedback"], [class*="agent-feedback"], [class*="composer"] [class*="feedback"], ' +
            '.ui-dialog, .ui-alert-dialog, [class*="ui-dialog"], [role="dialog"]'
        );
        var scopeList = scopes.length ? Array.prototype.slice.call(scopes) : [document.body];
        translateScopeListHints(scopeList, hints, {
            maxLen: 200,
            needleLen: 10,
            selector: 'h1, h2, h3, h4, p, span, div, button, label, textarea, input',
            translatePlaceholder: true,
            skipChildQuery: 'button, textarea, input',
            allowTags: ['BUTTON', 'TEXTAREA', 'INPUT']
        });
    }

    function localizeAgentChanges() {
        var hints = AGENT_CHANGE_COMMON_HINTS.concat(
            AGENT_CHANGE_TEXT_HINTS,
            COMMON_MENU_HINTS
        );
        var scopes = document.querySelectorAll(
            '[class*="agent-changes"], [class*="AgentChanges"], [class*="pending-changes"], ' +
            '[class*="review-control"], [class*="changes-header"], [class*="diff-against"], ' +
            '[class*="inline-diff"], [class*="diff-review"], [class*="review-widget"], ' +
            '[class*="composer-toolbar"], [class*="agent-review"]'
        );
        if (!scopes.length && !documentHasKeywordGroup('AGENT_CHANGES')) return;
        var scopeList = scopes.length ? Array.prototype.slice.call(scopes) : [document.body];
        translateScopeListHints(scopeList, hints, {
            maxLen: 120,
            needleLen: 12,
            selector: 'button, span, div, label, a, [role="button"], [role="menuitem"]',
            skipChildQuery: 'button, input, textarea',
            allowTags: ['BUTTON', 'A']
        });
    }

    function localizeEditorTitleTooltip() {
        var actions = document.querySelectorAll(
            '.editor-group-container .monaco-action-bar .action-item, ' +
            '.title-actions .action-item, .editor-actions .action-item, ' +
            '.tabs-and-actions-container .action-item, ' +
            '[class*="agent-pane"] .action-item, [class*="composer"] .title-actions .action-item, ' +
            '.pane-composite-part .action-item'
        );
        for (var i = 0; i < actions.length; i++) {
            var item = actions[i];
            translateAttributes(item);
            translateAttributes(item.querySelector('a, button, [role="button"]'));
            var label = item.querySelector('.action-label');
            if (label) {
                translateAttributes(label);
                var raw = (label.textContent || '').trim();
                if (raw && raw.length <= 80) {
                    var tr = lookupTranslation(raw);
                    if (!tr) {
                        for (var j = 0; j < AGENT_TOOLTIP_TEXT.length; j++) {
                            if (raw === AGENT_TOOLTIP_TEXT[j][0]) { tr = AGENT_TOOLTIP_TEXT[j][1]; break; }
                        }
                    }
                    if (tr && tr !== raw) label.textContent = tr;
                }
            }
        }
        try { translateCursorHoverWidget(document.body); } catch (e) {}
    }

    function localizeComposerToolbar() {
        var scopes = document.querySelectorAll(
            '[class*="composer"], [class*="aichat"], [class*="chat-input"], [class*="ComposerInput"], ' +
            '.pane-composite-part, [class*="agent-pane"], [class*="agent-changes"], [class*="pending-changes"]'
        );
        for (var r = 0; r < scopes.length; r++) {
            var scope = scopes[r];
            if (scope.closest('.monaco-editor .view-lines')) continue;
            var nodes = scope.querySelectorAll('button, span, div, label, .monaco-keybinding, [class*="keybinding"]');
            for (var i = 0; i < nodes.length; i++) {
                var el = nodes[i];
                if (el.closest('.monaco-editor .view-lines')) continue;
                translateAttributes(el);
                if (el.querySelector('button, input, textarea, [contenteditable="true"]') && el.tagName !== 'BUTTON') continue;
                var raw = (el.textContent || '').trim();
                if (!raw || raw.length > 80) continue;
                if (/^Stop\s/i.test(raw)) {
                    var stopTr = raw.replace(/^Stop\s*/i, '停止 ');
                    if (stopTr !== raw) el.textContent = stopTr;
                    continue;
                }
                var tr = lookupTranslation(raw) || replacePartialText(raw);
                if (tr && tr !== raw) safelyRewriteText(el, tr, [raw.slice(0, 8)]);
            }
        }
    }

    function localizeMentionMenu() {
        var hasMentionUi = document.querySelector(
            '.ui-slash-menu, .ui-slash-menu__content, .ui-menu__content, [data-mention-menu-flat-index]'
        );
        if (!hasMentionUi && !documentHasKeywordGroup('MENTION_MENU')) return;
        try { translateMentionMenu(); } catch (e) {}
        var mentionMenus = document.querySelectorAll(
            '.ui-slash-menu, .ui-slash-menu__content, .ui-menu__content, [data-mention-menu-flat-index]'
        );
        for (var mm = 0; mm < mentionMenus.length; mm++) {
            try { translateUIMenu(mentionMenus[mm]); } catch (e) {}
        }
    }

    function localizeComposerPlaceholders() {
        updatePlaceholderAttribute(document.body);
        var hints = [
            ['Edit selected code', '编辑所选代码'],
            ['Ask quick question', '快速提问'],
            ['Plan, Build, / for commands, @ for context', '计划、构建，输入 / 调用命令，输入 @ 添加上下文'],
            ['Ask, learn, brainstorm', '提问、学习、头脑风暴'],
            ['Ask questions without making changes...', '在不修改代码的情况下提问...'],
            ['Ask questions without making changes', '在不修改代码的情况下提问'],
            ['Run Cursor anywhere...', '在任意位置运行 Cursor...'],
            ['Add a follow-up', '添加后续问题'],
            ['Work on explicitly added files (no tools)', '处理已明确添加的文件（无工具）'],
            ['Reject, suggest, follow up?', '拒绝、建议、继续跟进？'],
            ['Continue locally', '在本地继续'],
            ['Ask follow-ups in the worktree', '在工作树中继续追问'],
            ['Enter additional context about the issue', '输入有关问题的更多上下文'],
            ['Editing queued message...', '正在编辑排队消息...'],
            ['Tell Cursor to use subagents to break down tasks, do work in parallel, and preserve context', '让 Cursor 使用子智能体拆分任务、并行处理工作并保留上下文'],
            ['Use `/model` to pick the best model for your task. Composer offers a great balance for cost vs. capability', '使用 `/model` 为您的任务选择最佳模型。Composer 在成本与能力之间提供了绝佳平衡。'],
            ['Use `/babysit` to triage PR comments, fix CI failures, and clear conflicts', '使用 `/babysit` 处理 PR 评论、修复 CI 失败并解决冲突'],
            ['Use `/create-hook` to control and extend the agent loop with custom scripts', '使用 `/create-hook` 通过自定义脚本控制和扩展智能体循环'],
            ['Use automations to save time on repetitive tasks with always-on agents', '使用自动化处理重复性任务，借助始终在线的智能体节省时间'],
            ['Message Cursor', '向 Cursor 发送消息'],
            ["Let's kick something off", '让我们开始吧']
        ];
        var prose = document.querySelectorAll(
            '.ProseMirror [data-placeholder], .ProseMirror p.is-editor-empty, ' +
            '.ui-prompt-input-editor [data-placeholder], [class*="prompt-input"] [data-placeholder], ' +
            '[class*="composer"] [data-placeholder], [contenteditable="true"][data-placeholder], ' +
            '.prompt-bar-container [data-placeholder], .prompt-bar-container [placeholder], ' +
            '.prompt-bar-input [data-placeholder], .prompt-edit-input [data-placeholder], ' +
            '.pure-ai-prompt-bar [data-placeholder], .ui-prompt-input [data-placeholder], ' +
            '.ui-prompt-input .ProseMirror, .ui-prompt-input .tiptap'
        );
        for (var m = 0; m < prose.length; m++) {
            var pel2 = prose[m];
            if (pel2.closest('.monaco-editor')) continue;
            var dph = pel2.getAttribute('data-placeholder');
            if (!dph) continue;
            var dtr = lookupTranslation(dph) || replacePartialText(dph);
            if (dtr && dtr !== dph) pel2.setAttribute('data-placeholder', dtr);
        }
        var placeholders = document.querySelectorAll('[class*="placeholder"], [class*="Placeholder"]');
        translateElementListHints(placeholders, hints, {
            needleLen: 12,
            leafOnly: true,
            skipMonacoEditor: true
        });
        translateElementListHints(
            document.querySelectorAll('div, span, p, label'),
            hints,
            {
                needleLen: 12,
                leafOnly: true,
                skipChildQuery: 'div, span, p',
                skipEditorElements: true
            }
        );
    }

    function localizeEditorSelection() {
        var labels = [
            ['Add to Chat', '添加到聊天'],
            ['Quick Edit', '快速编辑'],
            ['Create Rule', '创建规则'],
            ['Add Symbol to Current Chat', '将符号添加到当前对话'],
            ['Add Symbol to New Chat', '将符号添加到新对话']
        ];
        function updateLabel(el, from, to) {
            if (!el || !from || !to) return false;
            var raw = (el.textContent || '').trim();
            if (raw === from) {
                el.textContent = to;
                return true;
            }
            if (raw.indexOf(from) >= 0) {
                var neo = raw.split(from).join(to);
                if (neo !== raw) { el.textContent = neo; return true; }
            }
            return false;
        }
        // Cursor 选区浮动条：.cursorHoverWidget > .hoverButton > .text
        var hoverTexts = document.querySelectorAll('.cursorHoverWidget .hoverButton .text');
        for (var h = 0; h < hoverTexts.length; h++) {
            var ht = hoverTexts[h];
            if (ht.closest('.view-lines')) continue;
            var hraw = (ht.textContent || '').trim();
            translateAttributes(ht.parentElement || ht);
            for (var hj = 0; hj < labels.length; hj++) {
                if (updateLabel(ht, labels[hj][0], labels[hj][1])) break;
            }
            if (!hraw) continue;
            var htr = lookupTranslation(hraw);
            if (htr && htr !== hraw) ht.textContent = htr;
        }
        var hoverButtons = document.querySelectorAll('.cursorHoverWidget .hoverButton');
        for (var b = 0; b < hoverButtons.length; b++) {
            var btn = hoverButtons[b];
            translateAttributes(btn);
            var title = btn.getAttribute('title') || btn.getAttribute('aria-label') || '';
            for (var bj = 0; bj < labels.length; bj++) {
                if (title === labels[bj][0]) {
                    btn.setAttribute('title', labels[bj][1]);
                    btn.setAttribute('aria-label', labels[bj][1]);
                }
            }
        }
        var roots = document.querySelectorAll('.monaco-editor .contentWidgets, .monaco-editor .overlayWidgets, .context-view, .monaco-menu');
        for (var r = 0; r < roots.length; r++) {
            if (roots[r].classList && (roots[r].classList.contains('context-view') || roots[r].classList.contains('monaco-menu'))) {
                translateMonacoMenu(roots[r]);
                continue;
            }
            var nodes = roots[r].querySelectorAll('div, span, button, a, .action-label');
            for (var i = 0; i < nodes.length; i++) {
                var el = nodes[i];
                if (el.closest('.view-lines')) continue;
                if (el.closest('.cursorHoverWidget .hoverButton') && el.classList && el.classList.contains('commandHelpText')) continue;
                translateAttributes(el);
                if (el.querySelector('div, span, button') && !el.classList.contains('text')) continue;
                var raw = el.textContent || '';
                if (!raw || raw.length > 80) continue;
                var text = normalizeText(raw);
                for (var j = 0; j < labels.length; j++) {
                    if (text === labels[j][0]) {
                        safelyRewriteText(el, labels[j][1], [labels[j][0]]);
                        break;
                    }
                }
            }
        }
    }

    function localizePendingChangesMenu() {
        var menus = document.querySelectorAll(
            '.context-view, .monaco-menu-container, .monaco-menu, [role="menu"]'
        );
        if (!menus.length) return;
        var panelHints = [
            'Pending Changes', 'Changes waiting to be confirmed', 'Keep All', 'Undo All',
            'Find Issues', '待确认更改', '等待确认的更改', '全部保留', '全部撤销', '查找问题'
        ];
        if (!menuContainsKeywords(menus, panelHints) &&
            !document.querySelector('[class*="pending-changes"], [class*="agent-changes"], [class*="review-control"]')) {
            return;
        }
        for (var m = 0; m < menus.length; m++) {
            try { translateMonacoMenu(menus[m]); } catch (e) {}
            var labels = menus[m].querySelectorAll('.action-label');
            for (var i = 0; i < labels.length; i++) {
                updateMenuText(labels[i], COMMON_MENU_HINTS);
            }
        }
    }

    var isMenubarTranslationRunning = false;
    var menubarAnimationFrame = 0;

    function parseMenubarLabel(text) {
        var norm = normalizeText(text || '');
        if (!norm) return null;
        if (/^运行(\([A-Za-z]\))?$/.test(norm)) return null;
        var m = /^(File|Edit|Selection|View|Go|Terminal|Help)(?:\s*\(([A-Za-z])\))?$/.exec(norm);
        if (!m) return null;
        var zh = null;
        for (var i = 0; i < MENUBAR_HINTS.length; i++) {
            if (MENUBAR_HINTS[i][0] === m[1]) {
                zh = MENUBAR_HINTS[i][1];
                break;
            }
        }
        if (!zh) return null;
        return m[2] ? (zh + '(' + m[2] + ')') : zh;
    }

    function localizeMenubar() {
        if (isMenubarTranslationRunning) return;
        isMenubarTranslationRunning = true;
        try {
            var bars;
            try {
                bars = document.querySelectorAll(
                    '.menubar, [role="menubar"], .titlebar .menubar, .part.titlebar [role="menubar"]'
                );
            } catch (e) { return; }
            if (!bars.length) return;
            var seen = new Set();
            for (var b = 0; b < bars.length; b++) {
                var bar = bars[b];
                if (!bar || seen.has(bar)) continue;
                seen.add(bar);
                var buttons;
                try {
                    buttons = bar.querySelectorAll('.menubar-menu-button, [role="menuitem"]');
                } catch (e) { continue; }
                if (!buttons.length) {
                    try { buttons = bar.querySelectorAll('.menubar-menu-title'); } catch (e2) { continue; }
                }
                for (var i = 0; i < buttons.length; i++) {
                    var el = buttons[i];
                    if (!el) continue;
                    var titleEl = el;
                    try {
                        var inner = el.querySelector && el.querySelector('.menubar-menu-title');
                        if (inner) titleEl = inner;
                    } catch (e3) {}
                    var raw = normalizeText(titleEl.textContent || '');
                    if (/[\u4e00-\u9fff]/.test(raw)) continue;
                    var tr = parseMenubarLabel(raw);
                    if (tr && tr !== raw) {
                        try { titleEl.textContent = tr; } catch (e4) {}
                    }
                    try {
                        var aria = el.getAttribute && el.getAttribute('aria-label');
                        if (aria && !/[\u4e00-\u9fff]/.test(aria)) {
                            var atr = parseMenubarLabel(aria);
                            if (atr && atr !== aria) el.setAttribute('aria-label', atr);
                        }
                    } catch (e5) {}
                }
            }
        } finally {
            isMenubarTranslationRunning = false;
        }
    }

    function queueMenubarTranslation() {
        try { localizeMenubar(); } catch (e) {}
        if (menubarAnimationFrame) return;
        var times = 0;
        function trackMenubar() {
            menubarAnimationFrame = 0;
            try { localizeMenubar(); } catch (e) {}
            times++;
            if (times < 2) {
                menubarAnimationFrame = requestAnimationFrame(trackMenubar);
            }
        }
        menubarAnimationFrame = requestAnimationFrame(trackMenubar);
    }

    function installMenubarObserver() {
        if (window.__cursorZhMenubarTranslation) return;
        window.__cursorZhMenubarTranslation = true;
        var obs = null;
        function bindMenubar(bar) {
            if (!bar || bar.__cursorZhMenubarBound) return;
            bar.__cursorZhMenubarBound = true;
            if (!obs) {
                obs = new MutationObserver(function() {
                    queueMenubarTranslation();
                });
            }
            try {
                obs.observe(bar, { childList: true, subtree: true, characterData: true });
            } catch (e) {}
        }
        function scanToolbar() {
            try {
                var bars = document.querySelectorAll('.menubar, [role="menubar"]');
                for (var i = 0; i < bars.length; i++) bindMenubar(bars[i]);
            } catch (e) {}
            queueMenubarTranslation();
        }
        scanToolbar();
        setTimeout(scanToolbar, 400);
        window.addEventListener('focus', function() {
            queueMenubarTranslation();
        }, true);
    }

    function localizeCommitScores() {
        var roots = [];
        var seen = new Set();
        function pushRoot(el) {
            if (!el || seen.has(el)) return;
            seen.add(el);
            roots.push(el);
        }
        try {
            var sb = document.querySelectorAll(
                '.part.statusbar, .statusbar, [id="workbench.parts.statusbar"], .statusbar-item'
            );
            for (var i = 0; i < sb.length; i++) pushRoot(sb[i]);
            var hovers = document.querySelectorAll(TOOLTIP_SELECTOR);
            for (var h = 0; h < hovers.length; h++) {
                var t = hovers[h].textContent || '';
                if (/Most Recent Commit Scored|AI-Generated:|Agent Stats:|Tab Stats:|Total Changes:|最近评分的提交|AI 生成：|智能体统计：/.test(t)) {
                    pushRoot(hovers[h]);
                }
            }
        } catch (e) { return; }
        for (var r = 0; r < roots.length; r++) {
            var root = roots[r];
            try { translateAttributes(root); } catch (e2) {}
            var walker;
            try { walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null); } catch (e3) { continue; }
            var tnode;
            while ((tnode = walker.nextNode())) {
                try {
                    if (tnode.parentElement && tnode.parentElement.closest('.monaco-editor .view-lines')) continue;
                } catch (e4) {}
                var text = tnode.textContent;
                if (!text) continue;
                var tr = translateCommitScoreText(text) || lookupTranslation(text) || replacePartialText(text);
                if (tr && tr !== text) tnode.textContent = tr;
            }
        }
    }

    function localizeEditorContextMenu() {
        var menus = document.querySelectorAll(
            '.context-view, .monaco-menu-container, .monaco-menu, [role="menu"]'
        );
        if (!menus.length) return;

        for (var m = 0; m < menus.length; m++) {
            var menu = menus[m];
            if (menu.closest('.monaco-editor .view-lines')) continue;
            try { translateMonacoMenu(menu); } catch (e) {}
            try { translateEditorMenuItems(menu); } catch (e) {}
        }
    }

    function menuContainsKeywords(menus, words) {
        if (!menus || !menus.length) return false;
        for (var m = 0; m < menus.length; m++) {
            var text = normalizeText(menus[m].textContent || '');
            if (!text) continue;
            for (var i = 0; i < words.length; i++) {
                if (text.indexOf(words[i]) !== -1) return true;
            }
        }
        return false;
    }

    function localizeChatHistory() {
        var menus = document.querySelectorAll(
            '.context-view, .monaco-menu-container, .monaco-menu, [role="menu"], ' +
            '.ui-menu, .ui-menu__layout, .ui-menu__content'
        );
        var chatHints = [
            'Search Agents', 'Chat History', 'Today', 'Yesterday', 'Older', 'Archived',
            'Open in New Tab', 'Rename Chat', 'Restore', 'Pin', 'Keep All', 'Undo All', 'Draft',
            'Fork Chat', 'Mark as Unread', 'Archive Prior Chats', 'Delete', 'Rename',
            'Show more', 'Show less', 'Show 1 more', 'New Chat', 'Agent Conversations',
            '已归档', '聊天历史', '搜索智能体', '今天', '昨天', '更早', '固定', '恢复', '草稿', '再显示',
            '分叉对话', '标记为未读', '归档较早的对话', '全部保留', '全部撤销', '在新标签页中打开'
        ];
        var hasChatHistoryPanel = document.querySelector(
            '[class*="chat-history"], [class*="ChatHistory"], [class*="agent-history"], [class*="AgentHistory"], ' +
            '[id*="agents"], [class*="agents-list"], [class*="AgentsList"]'
        );
        var hasAgentSearch = document.querySelector(
            'input[placeholder="Search Agents..."], input[aria-placeholder="Search Agents..."], ' +
            '[data-placeholder="Search Agents..."], [placeholder="Search Agents..."]'
        );
        if (!hasChatHistoryPanel && !hasAgentSearch && (!menus.length || !menuContainsKeywords(menus, chatHints))) return;

        try { translateChatMenu(); } catch (e) {}

        var textHints = CHAT_MENU_HINTS.concat(CHAT_HISTORY_HINTS);

        try { updatePlaceholderAttribute(document.body); } catch (e) {}
        var searchRoots = hasChatHistoryPanel ? [hasChatHistoryPanel] : (hasAgentSearch ? [hasAgentSearch.closest('[class*="agent"], [class*="chat"], [class*="Chat"], [role="dialog"], .pane-composite-part') || document.body] : [document.body]);
        for (var sr = 0; sr < searchRoots.length; sr++) {
            var sroot = searchRoots[sr];
            if (!sroot) continue;
            try { updatePlaceholderAttribute(sroot); } catch (e) {}
            var searchInputs = sroot.querySelectorAll(
                'input, textarea, [role="searchbox"], [role="combobox"], [contenteditable="true"]'
            );
            for (var si = 0; si < searchInputs.length; si++) {
                try { translateAttributes(searchInputs[si]); } catch (e) {}
            }
            var phOverlays = sroot.querySelectorAll('[class*="placeholder"], [class*="Placeholder"]');
            for (var po = 0; po < phOverlays.length; po++) {
                var pov = phOverlays[po];
                if (pov.closest('.monaco-editor')) continue;
                var povText = normalizeText(pov.textContent || '');
                if (povText === 'Search Agents...') {
                    safelyRewriteText(pov, '搜索智能体...', ['Search Agents']);
                }
            }
        }

        for (var m = 0; m < menus.length; m++) {
            translateMonacoMenu(menus[m]);
            translateUIMenu(menus[m]);
        }

        var scopes = document.querySelectorAll(
            '[class*="agent"], [class*="chat-history"], [class*="ChatHistory"], ' +
            '[id*="agents"], .pane-composite-part, .context-view, .monaco-menu, ' +
            '.ui-menu, .ui-menu__layout, .ui-menu__content'
        );
        var scopeList = scopes.length ? Array.prototype.slice.call(scopes) : [document.body];
        for (var r = 0; r < scopeList.length; r++) {
            translateScopeLeafHints(scopeList[r], textHints, { maxLen: 120, needleLen: 8 });
        }

        replaceTextNodeFragments(document.body, [['Draft: ', '草稿：']]);
    }

    function localizeAgentModes() {
        if (!documentHasKeywordGroup('AGENT_MODES')) return;
        var hints = [
            ['Switch Agent Mode', '切换智能体模式'],
            ['Agent Mode', '智能体模式'],
            ['Plan', '计划'],
            ['Debug', '调试'],
            ['Multitask', '多任务'],
            ['Ask', '询问'],
            ['Create detailed plans for accomplishing tasks', '为完成任务创建详细计划'],
            ['Create structured plans with implementation steps', '创建包含实施步骤的结构化计划'],
            ['Systematically diagnose and fix bugs using runtime traces', '使用运行时追踪系统诊断并修复缺陷'],
            ['Run and coordinate multiple tasks in parallel', '并行运行并协调多个任务'],
            ['Ask Cursor questions about your codebase', '就代码库向 Cursor 提问'],
            ['Generate an implementation plan', '生成实现计划'],
            ['Pinpoint the root cause of an issue', '定位问题的根本原因'],
            ['固定point the root cause of an issue', '定位问题的根本原因'],
            ['Orchestrate multiple subagents in parallel', '并行编排多个子智能体'],
            ['Answer questions without making edits', '回答问题但不进行编辑'],
            ['Search skills, context, chats...', '搜索技能、上下文、对话...'],
            ['Plan, search, make edits, run commands', '规划、搜索、编辑、运行命令'],
            ['Using terminal selections', '使用终端选区'],
            ['Using image', '使用图像'],
            ['Using video', '使用视频'],
            ['Empty message...', '空消息...'],
            ['Message is too long to display', '消息过长无法显示']
        ];
        var roots = document.querySelectorAll('.monaco-hover, .monaco-hover-content, [role="tooltip"], [role="menu"], [role="menuitem"], .context-view, .monaco-menu, div, span, p');
        translateElementListHints(roots, hints, { maxLen: 200, needleLen: 8, leafOnly: true });
    }

    function getBrowserWebviewTranslationScript() {
        return '(function(){try{' +
            'var E={' +
            '"Browser":"浏览器",' +
            '"Enter a URL above, or instruct the Agent to navigate and use the browser":"在上方输入 URL，或指示智能体导航并使用浏览器",' +
            '"Enter a URL above, or instruct the Agent to navigate and use the browser.":"在上方输入 URL，或指示智能体导航并使用浏览器。",' +
            '"Search or enter URL":"搜索或输入 URL",' +
            '"Connection Failed":"连接失败",' +
            '"Restart Browser":"重启浏览器",' +
            '"Reload":"重新加载",' +
            '"Show Details":"显示详情",' +
            '"Hide Details":"隐藏详情",' +
            '"Connection was refused.":"连接被拒绝。",' +
            '"Connection was refused":"连接被拒绝",' +
            '"This site can\'t be reached":"无法访问此网站",' +
            '"This site can&#39;t be reached":"无法访问此网站",' +
            '"Certificate Error":"证书错误",' +
            '"The certificate for this site is not trusted":"此站点的证书不受信任",' +
            '"Copy error details":"复制错误详情",' +
            '"Inspect Element":"检查元素",' +
            '"Copy Messages":"复制消息",' +
            '"Fork Conversation":"分叉对话"' +
            '};' +
            'function tx(t){if(t==null)return t;var s=String(t).trim();if(E[s])return E[s];var o=String(t);for(var k in E){if(o.indexOf(k)!==-1)o=o.split(k).join(E[k]);}return o;}' +
            'function fix(sel,attr){var els=document.querySelectorAll(sel);for(var i=0;i<els.length;i++){var el=els[i];if(attr){var v=el.getAttribute(attr);if(v){var tr=tx(v);if(tr&&tr!==v)el.setAttribute(attr,tr);}}else{var raw=(el.textContent||"").trim();if(!raw)continue;var tr2=tx(raw);if(tr2&&tr2!==raw)el.textContent=tr2;}}}' +
            'fix(".browser-welcome-title");fix(".browser-welcome-subtitle");' +
            'fix(".browser-error-title,.glass-browser-error-title");' +
            'fix(".browser-error-restart-button,.glass-browser-error-page button");' +
            'fix(".browser-error-details-toggle");' +
            'fix(".browser-error-copy-button","title");' +
            'var sub=document.querySelector(".browser-error-subtitle,.glass-browser-error-subtitle");' +
            'if(sub){var walker=document.createTreeWalker(sub,NodeFilter.SHOW_TEXT,null);var n;while((n=walker.nextNode())){var raw3=(n.textContent||"").trim();if(!raw3)continue;var tr3=tx(raw3);if(tr3&&tr3!==raw3)n.textContent=tr3;}}' +
            'function fixMenu(){fix("[role=menuitem]");fix("menuitem");fix(".context-menu-item");}' +
            'document.addEventListener("contextmenu",function(){setTimeout(fixMenu,16);setTimeout(fixMenu,120);setTimeout(fixMenu,400);},true);' +
            '}catch(e){}})();';
    }

    function runBrowserWebviewTranslation(wv) {
        if (!wv || typeof wv.executeJavaScript !== 'function') return;
        var script = getBrowserWebviewTranslationScript();
        try {
            wv.executeJavaScript(script, false).catch(function() {});
        } catch (e) {}
    }

    function translateBrowserWebview() {
        try {
            var webviews = document.querySelectorAll('webview');
            for (var i = 0; i < webviews.length; i++) {
                runBrowserWebviewTranslation(webviews[i]);
            }
        } catch (e) {}
    }

    function bindBrowserWebview(wv) {
        if (!wv || wv.__cursorZhBrowserTranslationBound) return;
        wv.__cursorZhBrowserTranslationBound = true;
        var run = function() {
            translateBrowserWebview();
            setTimeout(translateBrowserWebview, 120);
            setTimeout(translateBrowserWebview, 500);
            setTimeout(translateBrowserWebview, 1200);
        };
        try {
            wv.addEventListener('dom-ready', run);
            wv.addEventListener('did-finish-load', run);
            wv.addEventListener('did-fail-load', run);
            wv.addEventListener('did-navigate', run);
            wv.addEventListener('did-navigate-in-page', run);
        } catch (e) {}
        run();
    }

    function installBrowserWebviewObserver() {
        if (window.__cursorZhBrowserWebviewObserver) return;
        try {
            var existing = document.querySelectorAll('webview');
            for (var e = 0; e < existing.length; e++) bindBrowserWebview(existing[e]);
            var obs = new MutationObserver(function(muts) {
                for (var i = 0; i < muts.length; i++) {
                    var added = muts[i].addedNodes;
                    for (var j = 0; j < added.length; j++) {
                        var node = added[j];
                        if (!node || node.nodeType !== 1) continue;
                        if (node.tagName === 'WEBVIEW') bindBrowserWebview(node);
                        if (node.querySelectorAll) {
                            var wvs = node.querySelectorAll('webview');
                            for (var k = 0; k < wvs.length; k++) bindBrowserWebview(wvs[k]);
                        }
                    }
                }
            });
            obs.observe(document.body, { childList: true, subtree: true });
            window.__cursorZhBrowserWebviewObserver = obs;
        } catch (e) {}
    }

    function localizeBrowserToolbar() {
        if (!document.querySelector(
            '.browser-tools, .browser-navbar, .browser-tab, [class*="browser-tab"], [class*="browser-navbar"], [class*="browser-tools"]'
        )) return;
        var hints = BROWSER_TOOLBAR_HINTS;
        var urlInputs = document.querySelectorAll(
            '.browser-navbar input, .browser-tools input, [class*="browser-navbar"] input, ' +
            '[class*="browser-tools"] input, [class*="address-bar"] input, [class*="url-input"] input'
        );
        for (var u = 0; u < urlInputs.length; u++) {
            var inp = urlInputs[u];
            var ph = inp.getAttribute('placeholder');
            if (ph) {
                var ptr = lookupTranslation(ph) || replacePartialText(ph);
                if (ptr && ptr !== ph) inp.setAttribute('placeholder', ptr);
            }
            translateAttributes(inp);
        }
        function updateButtonTooltip(btn) {
            updateAttributeHints(btn, hints);
        }
        function updateToolbarText(el) {
            if (!el || el.closest('.monaco-editor .view-lines')) return;
            if (el.querySelector('div, span, button') && el.childElementCount > 0) return;
            updateLeafTextHints(el, hints, { maxLen: 60, needleLen: 10 });
        }
        var toolbarBtns = document.querySelectorAll(
            '.browser-tools button, .browser-navbar button, .nav-button, .nav-controls button, ' +
            '[class*="browser-tab"] button, [class*="browser-navbar"] button, [class*="browser-tools"] button, ' +
            '.browser-navbar [role="button"], .browser-tools [role="button"], ' +
            '[class*="browser-navbar"] [role="button"], [class*="browser-tools"] [role="button"]'
        );
        for (var b = 0; b < toolbarBtns.length; b++) updateButtonTooltip(toolbarBtns[b]);
        var hovers = document.querySelectorAll('.monaco-hover, .monaco-hover-content, [role="tooltip"]');
        for (var h = 0; h < hovers.length; h++) {
            var ht = hovers[h];
            if (ht.closest('.monaco-editor .view-lines')) continue;
            updateButtonTooltip(ht);
            var nodes = ht.querySelectorAll('span, div, p, .monaco-action-bar .action-label');
            for (var n = 0; n < nodes.length; n++) updateToolbarText(nodes[n]);
        }
        var EMPTY_STATE_HINTS = [
            ['Browser', '浏览器'],
            ['Enter a URL above, or instruct the Agent to navigate and use the browser', '在上方输入 URL，或指示智能体导航并使用浏览器'],
            ['Enter a URL above, or instruct the Agent to navigate and use the browser.', '在上方输入 URL，或指示智能体导航并使用浏览器。']
        ];
        var emptyStateScopes = document.querySelectorAll(
            '.browser-tab, [class*="browser-tab"], [class*="browser-view"], [class*="browser-empty"], ' +
            '[class*="browser-navbar"], .browser-tools, iframe + div, [class*="simple-browser"]'
        );
        var emptyStateElements = emptyStateScopes.length ? Array.prototype.slice.call(emptyStateScopes) : [];
        for (var kb = 0; kb < emptyStateElements.length; kb++) {
            var kbRoot = emptyStateElements[kb];
            if (!kbRoot || kbRoot.closest('.monaco-editor .view-lines')) continue;
            replaceTextNodeFragments(kbRoot, EMPTY_STATE_HINTS);
            var kbEls = kbRoot.querySelectorAll('div, span, p, h1, h2, h3, label');
            for (var ke = 0; ke < kbEls.length; ke++) {
                var kbEl = kbEls[ke];
                if (kbEl.closest('.monaco-editor .view-lines')) continue;
                var kbText = normalizeText(kbEl.textContent || '');
                if (!kbText || kbText.length > 200) continue;
                if (kbEl.querySelector('div, span, p') && kbEl.childElementCount > 2) continue;
                for (var kh = 0; kh < EMPTY_STATE_HINTS.length; kh++) {
                    if (kbText === EMPTY_STATE_HINTS[kh][0]) {
                        safelyRewriteText(kbEl, EMPTY_STATE_HINTS[kh][1], [EMPTY_STATE_HINTS[kh][0].slice(0, 16)]);
                        break;
                    }
                }
                var kbTr = lookupTranslation(kbText) || replacePartialText(kbText);
                if (kbTr && kbTr !== kbText) safelyRewriteText(kbEl, kbTr, [kbText.slice(0, 16)]);
            }
        }
        if (!window.__cursorZhBrowserToolbarHoverHook) {
            window.__cursorZhBrowserToolbarHoverHook = true;
            document.addEventListener('mouseover', function(ev) {
                var btn = ev.target && ev.target.closest && ev.target.closest(
                    '.browser-tools button, .browser-navbar button, .nav-button, .nav-controls button, ' +
                    '[class*="browser-tab"] button, [class*="browser-navbar"] button, [class*="browser-tools"] button, ' +
                    '.browser-navbar [role="button"], .browser-tools [role="button"], ' +
                    '[class*="browser-navbar"] [role="button"], [class*="browser-tools"] [role="button"]'
                );
                if (btn) updateButtonTooltip(btn);
                var tip = ev.target && ev.target.closest && ev.target.closest('.monaco-hover, [role="tooltip"]');
                if (tip) {
                    var kids = tip.querySelectorAll('span, div, p');
                    for (var k = 0; k < kids.length; k++) updateToolbarText(kids[k]);
                }
            }, true);
        }
        try { translateBrowserWebview(); } catch (e) {}
    }

    function scheduleBrowserToolbarTranslation() {
        function run() {
            try { localizeBrowserToolbar(); } catch (e) {}
        }
        run();
        setTimeout(run, 80);
        setTimeout(run, 250);
        setTimeout(run, 800);
    }

    function localizeBrowserMenu() {
        if (!documentHasKeywordGroup('BROWSER_TOOLS')) return;
        try { scheduleBrowserToolbarTranslation(); } catch (e) {}
        var hints = [
            ['Take Screenshot', '截取屏幕截图'],
            ['Capture Area Screenshot', '截取区域截图'],
            ['Hard Reload', '强制重新加载'],
            ['Copy Current URL', '复制当前 URL'],
            ['Show Bookmark Bar', '显示书签栏'],
            ['Clear Browsing History', '清除浏览历史'],
            ['Clear Cookies', '清除 Cookie'],
            ['Clear Cache', '清除缓存'],
            ['Inspect Element', '检查元素']
        ];
        var roots = document.querySelectorAll('[role="menuitem"], li, div, span, button');
        translateElementListHints(roots, hints, {
            maxLen: 120,
            skipDictionary: true,
            leafOnly: true
        });
    }

    function localizeBrowserErrors() {
        try { translateBrowserWebview(); } catch (e) {}
        var hasBrowserUi = document.querySelector(
            'webview, .browser-navbar, .browser-tools, [class*="browser-navbar"], ' +
            '.browser-error-page, .browser-error-overlay, .glass-browser-error-page'
        );
        if (!hasBrowserUi && !documentHasKeywordGroup('BROWSER_ERRORS')) return;
        var hints = [
            ['Connection Failed', '连接失败'],
            ['Connection failed', '连接失败'],
            ['Connection Error', '连接错误'],
            ['The connection failed 10 times. Please check your network connection and try again.', '连接失败了 10 次。请检查网络连接后重试。'],
            ['Connection failed. Please try again, or contact support if the issue persists.', '连接失败。请重试，或在问题持续存在时联系支持。'],
            ['Connection failed. Please try again, or contact support if the issue persists', '连接失败。请重试，或在问题持续存在时联系支持'],
            ["Don't Open", '不要打开'],
            ['Open in Cursor Browser', '在 Cursor 浏览器中打开'],
            ['Open in External Browser', '在外部浏览器中打开'],
            ['Copy Link', '复制链接'],
            ['Restart Browser', '重启浏览器'],
            ['Reload', '重新加载'],
            ['Show Details', '显示详情'],
            ['Hide Details', '隐藏详情'],
            ['Connection was refused.', '连接被拒绝。'],
            ['Connection was refused', '连接被拒绝'],
            ["This site can't be reached", '无法访问此网站'],
            ['This site can&#39;t be reached', '无法访问此网站'],
            ['Certificate Error', '证书错误'],
            ['The certificate for this site is not trusted', '此站点的证书不受信任'],
            ['Copy error details', '复制错误详情']
        ];
        var errorEls = document.querySelectorAll(
            '.browser-error-title, .browser-error-subtitle, .browser-error-restart-button, ' +
            '.browser-error-details-toggle, .browser-error-copy-button, ' +
            '.glass-browser-error-title, .glass-browser-error-subtitle, .glass-browser-error-page button'
        );
        translateElementListHints(errorEls, hints, { maxLen: 160, needleLen: 12, leafOnly: true });
        var roots = document.querySelectorAll(
            '.browser-error-page, .browser-error-overlay, .glass-browser-error-page, ' +
            '.browser-navbar, .browser-tools, [class*="browser-view"], [class*="simple-browser"]'
        );
        for (var r = 0; r < roots.length; r++) {
            try { translateSubtree(roots[r]); } catch (e) {}
        }
        try {
            var iframes = document.querySelectorAll('iframe');
            for (var i = 0; i < iframes.length; i++) {
                try {
                    var doc = iframes[i].contentDocument;
                    if (doc && doc.body) translateSubtree(doc.body);
                } catch (e) {}
            }
        } catch (e) {}
    }

    function localizeQueuedMessages() {
        var hasQueueUi = !!document.querySelector(
            '.composer-queue-edit-banner, [class*="composer-queue"], [class*="message-queue"], ' +
            '.context-pill-image, .image-pill-container, .ui-prompt-input-image-preview'
        );
        if (!hasQueueUi && !documentHasKeywordGroup('MESSAGE_QUEUE')) return;
        var hints = [
            ['Queued', '已排队'],
            ['Send now', '立即发送'],
            ['Send After Current Message', '在当前消息之后发送'],
            ['Send after current message', '在当前消息之后发送'],
            ['Send Right Away', '立即发送'],
            ['Edit queued message', '编辑排队消息'],
            ['Editing queued message', '正在编辑排队消息'],
            ['Editing queued message...', '正在编辑排队消息...'],
            ['Edit Queued', '编辑排队'],
            ['Attached image', '附加图片'],
            ['View image', '查看图片'],
            ['Remove from queue', '从队列移除']
        ];
        var scopes = document.querySelectorAll(
            '.composer-queue-edit-banner, .composer-queue-edit-banner-text, ' +
            '[class*="composer"] [class*="queue"], [class*="message-queue"], [class*="queued"], ' +
            '.context-pill-image, .image-pill-container, .ui-prompt-input-image-preview, ' +
            '[class*="composer"] button, .monaco-hover, [role="tooltip"], img[alt]'
        );
        translateScopeAttributesAndHints(scopes, hints, {
            maxLen: 60,
            needleLen: 10,
            selector: 'span, div, button, label',
            skipMultiChild: true
        });
    }

    // __CURSOR_SETTINGS_FRAGMENTS_BLOCK__

    function localizeCursorSettings() {
        var root = getCursorSettingsRoot();
        if (!root) return;
        translateSettingsDescription(root, getSettingsDescriptionConfig());
        translateSettingsLabel(root);
    }

    // __DROPDOWN_FRAGMENTS_BLOCK__


    function translateDropdownText(node, isSettingsMode) {
        if (!node || isEditorRegion(node)) return;
        if (isQuickInputRegion(node.parentElement)) return;
        try {
            if (node.parentElement && isMenuRegion(node.parentElement) && !isMenuTextNode(node)) return;
        } catch (e) {}
        var text = node.textContent;
        if (!text || text.length > 200) return;
        var trimmed = normalizeText(text);
        if (!trimmed) return;
        if (isSettingsMode && trimmed === 'Stop') {
            try {
                var combo = node.parentElement && node.parentElement.closest(
                    '[role="combobox"], .monaco-select-box, [class*="select-box"]'
                );
                if (combo && /send\s+right\s+away/i.test(combo.textContent || '')) return;
            } catch (e) {}
        }
        var tierOnly = { 'fast': '快速' };
        if (tierOnly[trimmed.toLowerCase()]) {
            node.textContent = tierOnly[trimmed.toLowerCase()];
            return;
        }
        var result = text;
        for (var i = 0; i < DROPDOWN_FRAGMENTS.length; i++) {
            result = result.split(DROPDOWN_FRAGMENTS[i][0]).join(DROPDOWN_FRAGMENTS[i][1]);
        }
        var normed = normalizeText(result);
        var tr = lookupTranslation(normed) || replacePartialText(result);
        if (!tr) {
            for (var j = 0; j < translationPatterns.length; j++) {
                if (translationPatterns[j][0].test(normed)) {
                    tr = normed.replace(translationPatterns[j][0], translationPatterns[j][1]);
                    break;
                }
            }
        }
        if (tr) result = tr;
        if (result !== text) node.textContent = result;
    }

    function walkDropdownText(roots, isSettingsMode) {
        var seen = new Set();
        for (var r = 0; r < roots.length; r++) {
            var root = roots[r];
            if (!root || seen.has(root)) continue;
            seen.add(root);
            var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
            var node;
            while ((node = walker.nextNode())) {
                if (node.parentElement && node.parentElement.closest('input, textarea')) continue;
                translateDropdownText(node, isSettingsMode);
            }
        }
    }

    function localizeDropdownPanels() {
        var scopes = document.querySelectorAll(
            '.monaco-select-box-dropdown-container, .context-view, .monaco-list-row, ' +
            '[role="listbox"], [role="option"], .monaco-hover, .monaco-hover-content, ' +
            '[class*="model-picker"], [class*="premium-model"], [class*="upgrade"], ' +
            '.monaco-menu, .monaco-menu-container, [role="menu"], [role="menuitem"]'
        );
        walkDropdownText(scopes, false);
        var menuRoots = document.querySelectorAll(
            '.context-view, .monaco-menu-container, .monaco-menu, [role="menu"], ' +
            '.ui-menu, .ui-menu__layout, .ui-menu__content, [role="listbox"]'
        );
        for (var cg = 0; cg < menuRoots.length; cg++) {
            try { translateMonacoMenu(menuRoots[cg]); } catch (e) {}
            try { translateEditorMenuItems(menuRoots[cg]); } catch (e) {}
            try { translateUIMenu(menuRoots[cg]); } catch (e) {}
        }
        try { translateChatMenu(); } catch (e) {}
        if (isCursorSettingsRegion()) {
            var settingScopes = document.querySelectorAll(
                '[class*="cursor-settings"] [role="combobox"], [class*="cursor-settings"] .monaco-select-box, ' +
                '[class*="cursor-settings"] [class*="select-box"], [class*="cursor-settings"]'
            );
            walkDropdownText(settingScopes, true);
        }
    }

    function isCursorSettingsRegion() {
        return !!document.querySelector('[class*="cursor-settings"], .cursor-settings-cell');
    }

    function localizeSettingsDropdowns() {
        localizeDropdownPanels();
    }

    function installSettingsDropdownObserver() {
        if (window.__cursorZhSettingsDropdownObserver) return;
        var root = document.body;
        var debounce = null;
        var obs = new MutationObserver(function() {
            if (debounce) clearTimeout(debounce);
            debounce = setTimeout(function() {
                try { localizeDropdownPanels(); } catch (e) {}
            }, 70);
        });
        try {
            obs.observe(root, { childList: true, subtree: true, characterData: true });
            window.__cursorZhSettingsDropdownObserver = obs;
        } catch (e) {}
    }

    function getHiddenDialogFragments() {
        return [
            ['Reset "Don\'t Ask Again" Dialogs', '重置「不再询问」对话框'],
            ['Reset \'Don\'t Ask Again\' Dialogs', '重置「不再询问」对话框'],
            ['See warnings and tips that you\'ve hidden', '查看您已隐藏的警告和提示'],
            ['No Hidden Dialogs Yet', '暂无隐藏的对话框'],
            ['You haven\'t marked any dialogs as "Don\'t ask again".', '您尚未将任何对话框标记为「不再询问」。'],
            ['You haven\'t marked any dialogs as \'Don\'t ask again\'.', '您尚未将任何对话框标记为「不再询问」。'],
            ['You haven\'t marked any dialogs as "Don\'t ask again". Any hidden dialogs will appear here to manage.', '您尚未将任何对话框标记为「不再询问」。已隐藏的对话框将显示在此处以供管理。'],
            ['You haven\'t marked any dialogs as \'Don\'t ask again\'. Any hidden dialogs will appear here to manage.', '您尚未将任何对话框标记为「不再询问」。已隐藏的对话框将显示在此处以供管理。'],
            ['Any hidden dialogs will appear here to manage.', '已隐藏的对话框将显示在此处以供管理。']
        ];
    }

    function localizeHiddenDialogSettings() {
        var bodyText = '';
        try { bodyText = document.body ? (document.body.textContent || '') : ''; } catch (e) { return; }
        if (bodyText.indexOf('Ask Again') === -1) return;
        if (bodyText.indexOf('Hidden Dialogs') === -1 &&
            bodyText.indexOf('hidden dialogs') === -1 &&
            bodyText.indexOf('暂无隐藏') === -1) return;
        var fragments = getHiddenDialogFragments();
        var roots = document.querySelectorAll(
            '[class*="cursor-settings"], .settings-editor, .settings-body, [class*="settings-group"], [class*="setting-item"]'
        );
        var scopeList = roots.length ? Array.prototype.slice.call(roots) : [document.body];
        for (var r = 0; r < scopeList.length; r++) {
            var scopeText = scopeList[r].textContent || '';
            if (scopeText.indexOf('Ask Again') === -1 && scopeText.indexOf('暂无隐藏') === -1) continue;
            replaceTextNodeFragments(scopeList[r], fragments);
        }
        translateScopeListHints(scopeList, fragments, {
            maxLen: 240,
            needleLen: 14,
            leafOnly: true,
            selector: 'div, span, p, label, h1, h2, h3, button'
        });
        translateScopeDictionary(scopeList, {
            maxLen: 240,
            needleLen: 14,
            skipNestedInteractive: true,
            selector: 'div, span, p, label, h1, h2, h3'
        });
        var cursorRoot = getCursorSettingsRoot();
        if (cursorRoot) {
            try { translateSettingsLabel(cursorRoot); } catch (e) {}
        }
    }

    function localizeSettingsFragments() {
        var settingsRoot = getSettingsRoot();
        if (!settingsRoot) return;
        if (!settingsHaveKeywordGroup('SETTINGS_FRAGMENTS')) return;
        try { localizeCursorSettings(); } catch (e) {}
        translateSettingsSymlinkDescription(settingsRoot);
        translateSettingsLeafFragments(settingsRoot, [
            ['自动mation Profile', '自动化配置文件'],
            ['Focus 开 Command Execution', '命令执行时聚焦'],
            ['Preserve Cursor Position', '保留光标位置'],
            ['Natural Language 搜索', '自然语言搜索'],
            ['Auto Resume', '自动恢复'],
            ['Auto Store', '自动存储'],
            ['Partial Matches', '部分匹配'],
            ['Continue Prompt', '继续提示'],
            ['Reset \'Don\'t Ask Again\' Dialogs', '重置「不再询问」对话框'],
            ['Reset "Don\'t Ask Again" Dialogs', '重置「不再询问」对话框'],
            ['See warnings and tips that you\'ve hidden', '查看您已隐藏的警告和提示'],
            ['You haven\'t marked any dialogs as \'Don\'t ask again\'. Any hidden dialogs will appear here to manage.', '您尚未将任何对话框标记为「不再询问」。已隐藏的对话框将显示在此处以供管理。'],
            ['Your codebase, prompts, edits and other usage data will be stored and trained on by Cursor to improve the product.', '您的代码库、提示词、编辑内容和其他使用数据将由 Cursor 存储并用于训练，以改进产品。'],
            ['Your codebase, prompts, edits and other usage data will be stored and trained on by Cursor to improve the product', '您的代码库、提示词、编辑内容和其他使用数据将由 Cursor 存储并用于训练，以改进产品']
        ]);
        translateSettingsFragments(settingsRoot, [
            ['Reset \'Don\'t Ask Again\' Dialogs', '重置「不再询问」对话框'],
            ['Reset "Don\'t Ask Again" Dialogs', '重置「不再询问」对话框'],
            ['See warnings and tips that you\'ve hidden', '查看您已隐藏的警告和提示'],
            ['You haven\'t marked any dialogs as \'Don\'t ask again\'. Any hidden dialogs will appear here to manage.', '您尚未将任何对话框标记为「不再询问」。已隐藏的对话框将显示在此处以供管理。']
        ], function(text) {
            return lookupTranslation(text) || replacePartialText(text);
        }, {
            selector: 'div, span, p, label, h1, h2, h3',
            maxLen: 240
        });
    }

    function localizeAccountPlan() {
        var settingsRoot = getSettingsRoot();
        if (!settingsRoot) return;
        if (!settingsHaveKeywordGroup('ACCOUNT')) return;
        var hints = [
            ['Current Plan', '当前计划'],
            ['Current plan', '当前计划'],
            ['Your codebase, prompts, edits and other usage data will be stored and trained on by Cursor to improve the product.', '您的代码库、提示词、编辑内容和其他使用数据将由 Cursor 存储并用于训练，以改进产品。'],
            ['Your codebase, prompts, edits and other usage data will be stored and trained on by Cursor to improve the product', '您的代码库、提示词、编辑内容和其他使用数据将由 Cursor 存储并用于训练，以改进产品'],
            ['Review Changes', '审查更改'],
            ['New User Rule', '新建用户规则'],
            ['VS Code Settings', 'VS Code 设置'],
            ['Copy Domains', '复制域名'],
            ['Run Diagnostic', '运行诊断'],
            ['Tools & MCPs', '工具与 MCP']
        ];
        translateElementListHints(
            settingsRoot.querySelectorAll('div, span, p, label, button, a'),
            hints,
            {
                maxLen: 120,
                needleLen: 10,
                leafOnly: true,
                skipChildQuery: 'div, span, p, button',
                skipEditorElements: true
            }
        );
        var all = settingsRoot.querySelectorAll('div, span, p, label, button, a');
        for (var i = 0; i < all.length; i++) {
            var el = all[i];
            if (shouldSkipEditorElement(el)) continue;
            if (el.querySelector('div, span, p, button')) continue;
            var text = normalizeText(el.textContent || '');
            if (/^免费版\s+免费版$/i.test(text)) {
                safelyRewriteText(el, '免费版', ['免费版']);
            }
        }
        var baselines = document.querySelectorAll('.flex.items-baseline, [class*="items-baseline"]');
        for (var b = 0; b < baselines.length; b++) {
            var row = baselines[b];
            var kids = row.children;
            var freeSeen = false;
            for (var k = 0; k < kids.length; k++) {
                var kid = kids[k];
                var kt = normalizeText(kid.textContent || '');
                if (kt === '免费版' || kt === 'Free') {
                    if (freeSeen) {
                        kid.textContent = '';
                        kid.style.display = 'none';
                    } else {
                        freeSeen = true;
                        if (kt === 'Free') kid.textContent = '免费版';
                    }
                }
            }
        }
    }

    var TIMELINE_RESOURCE_NAMES = {
        'marketplace': '市场',
        'Marketplace': '市场'
    };

    function localizeTimeline() {
        var roots = [];
        var seen = new Set();
        function pushRoot(el) {
            if (!el || seen.has(el)) return;
            seen.add(el);
            roots.push(el);
        }
        document.querySelectorAll(
            '.timeline-tree-view, .timeline-view, [id="workbench.view.timeline"]'
        ).forEach(pushRoot);
        document.querySelectorAll('.pane-header, .composite.title').forEach(function(header) {
            var ht = header.textContent || '';
            if (/时间线|Timeline/i.test(ht)) pushRoot(header);
        });

        for (var r = 0; r < roots.length; r++) {
            var walker = document.createTreeWalker(roots[r], NodeFilter.SHOW_TEXT, null);
            var node;
            while ((node = walker.nextNode())) {
                if (SKIP_TAGS.has(node.parentElement && node.parentElement.tagName)) continue;
                var raw = node.textContent || '';
                var trimmed = normalizeText(raw);
                if (!trimmed) continue;
                var tr = TIMELINE_RESOURCE_NAMES[trimmed] || lookupTranslation(raw);
                if (tr && tr !== raw) {
                    var prefix = raw.substring(0, raw.indexOf(trimmed));
                    var suffix = raw.substring(raw.indexOf(trimmed) + trimmed.length);
                    node.textContent = prefix + tr + suffix;
                }
            }
        }
    }
