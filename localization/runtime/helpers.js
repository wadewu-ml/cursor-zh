    // Shared DOM helpers for localization passes.

    function updateAttributeHints(el, hints, attrs) {
        if (!el) return;
        attrs = attrs || ['title', 'aria-label'];
        for (var a = 0; a < attrs.length; a++) {
            var val = el.getAttribute(attrs[a]);
            if (!val) continue;
            var tr = lookupTranslation(val) || replacePartialText(val);
            if (tr) {
                el.setAttribute(attrs[a], tr);
                continue;
            }
            for (var j = 0; j < hints.length; j++) {
                if (val === hints[j][0]) {
                    el.setAttribute(attrs[a], hints[j][1]);
                    break;
                }
            }
        }
    }

    function updateLeafTextHints(el, hints, opts) {
        if (!el || el.closest('.monaco-editor .view-lines')) return;
        opts = opts || {};
        var maxLen = opts.maxLen || 120;
        var needleLen = opts.needleLen || 8;
        var allowTags = opts.allowTags || ['BUTTON', 'A', 'LI'];
        var skipChildQuery = opts.skipChildQuery ||
            'span, div, button, .action-label';
        if (opts.leafOnly) {
            if (el.querySelector('div, span, p, button, input, textarea')) return;
        } else if (el.querySelector(skipChildQuery) &&
            allowTags.indexOf(el.tagName) < 0 &&
            !(el.classList && el.classList.contains('action-label'))) return;
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
            if (opts.translatePlaceholder) {
                var ph = el.getAttribute('placeholder');
                if (ph) {
                    var phTr = lookupTranslation(ph) || replacePartialText(ph);
                    if (phTr && phTr !== ph) el.setAttribute('placeholder', phTr);
                }
            }
            return;
        }
        var text = normalizeText(el.textContent || '');
        if (!text || text.length > maxLen) return;
        for (var j = 0; j < hints.length; j++) {
            if (text === hints[j][0] ||
                (typeof normalizeQuotes === 'function' &&
                    normalizeQuotes(text) === normalizeQuotes(hints[j][0]))) {
                safelyRewriteText(el, hints[j][1], [hints[j][0].slice(0, needleLen)]);
                return;
            }
        }
        if (!opts.skipDictionary) {
            var tr = lookupTranslation(text) || replacePartialText(text);
            if (tr && tr !== text) safelyRewriteText(el, tr, [text.slice(0, Math.max(needleLen, 10))]);
        }
    }

    function translateScopeLeafHints(scope, hints, opts) {
        if (!scope || scope.closest('.monaco-editor .view-lines')) return;
        var selector = (opts && opts.selector) ||
            'span, div, label, button, a, li, .action-label';
        var els = scope.querySelectorAll(selector);
        for (var i = 0; i < els.length; i++) {
            translateAttributes(els[i]);
            updateLeafTextHints(els[i], hints, opts);
        }
    }

    function translateScopeFormHints(scope, hints, opts) {
        opts = opts || {};
        opts.translatePlaceholder = true;
        opts.skipChildQuery = opts.skipChildQuery || 'button, textarea, input';
        opts.allowTags = opts.allowTags || ['BUTTON', 'TEXTAREA', 'INPUT'];
        translateScopeLeafHints(scope, hints, opts);
    }

    function translateScopeListHints(scopeList, hints, opts) {
        for (var r = 0; r < scopeList.length; r++) {
            translateScopeLeafHints(scopeList[r], hints, opts);
        }
    }

    function translateElementListHints(roots, hints, opts) {
        for (var r = 0; r < roots.length; r++) {
            var el = roots[r];
            if (!el || el.closest('.monaco-editor .view-lines')) continue;
            if (opts && opts.skipEditorElements && shouldSkipEditorElement(el)) continue;
            if (opts && opts.skipMonacoEditor && el.closest('.monaco-editor')) continue;
            translateAttributes(el);
            updateLeafTextHints(el, hints, opts);
        }
    }

    function translateElementListSubstrings(roots, hints, opts) {
        opts = opts || {};
        var needleLen = opts.needleLen || 16;
        for (var r = 0; r < roots.length; r++) {
            var el = roots[r];
            if (!el) continue;
            if (el.closest('.monaco-editor .view-lines')) continue;
            if (opts.skipEditor && el.closest('.monaco-editor')) continue;
            translateAttributes(el);
            var text = normalizeText(el.textContent || '');
            if (!text) continue;
            if (opts.maxLen && text.length > opts.maxLen) continue;
            var matched = false;
            for (var j = 0; j < hints.length; j++) {
                if (text === hints[j][0] ||
                    text.indexOf(hints[j][0]) !== -1 ||
                    (typeof normalizeQuotes === 'function' &&
                        normalizeQuotes(text) === normalizeQuotes(hints[j][0]))) {
                    safelyRewriteText(el, hints[j][1], [hints[j][0].slice(0, needleLen)]);
                    matched = true;
                    break;
                }
            }
            if (!matched && !opts.skipDictionary) {
                var tr = lookupTranslation(text) || replacePartialText(text);
                if (tr && tr !== text) safelyRewriteText(el, tr, [text.slice(0, needleLen)]);
            }
        }
    }

    function translateScopeDictionary(scopeList, opts) {
        opts = opts || {};
        var selector = opts.selector ||
            'h1, h2, h3, h4, p, span, div, button, a, label';
        var maxLen = opts.maxLen || 600;
        var needleLen = opts.needleLen || 14;
        for (var s = 0; s < scopeList.length; s++) {
            var scope = scopeList[s];
            if (!scope) continue;
            var els = scope.querySelectorAll ? scope.querySelectorAll(selector) : [];
            for (var i = 0; i < els.length; i++) {
                var el = els[i];
                if (el.closest('.monaco-editor .view-lines')) continue;
                if (opts.skipHoverWidget && el.closest('.cursorHoverWidget')) continue;
                if (opts.skipNestedInteractive) {
                    if (el.querySelector('button, a') && el.tagName !== 'BUTTON' && el.tagName !== 'A') continue;
                    if (el.querySelector('h1, h2, h3, h4, p, div') &&
                        el.tagName !== 'BUTTON' && el.tagName !== 'A') continue;
                }
                translateAttributes(el);
                var raw = (el.textContent || '').trim();
                if (!raw || raw.length > maxLen) continue;
                var tr = lookupTranslation(raw) || replacePartialText(raw);
                if (tr && tr !== raw) {
                    safelyRewriteText(el, tr, [raw.slice(0, needleLen)]);
                }
            }
        }
    }

    function translateSettingsLeaves(settingsRoot, selector) {
        if (!settingsRoot) return [];
        return settingsRoot.querySelectorAll(selector || 'div, span, p, label');
    }

    function translateSettingsFragments(settingsRoot, fragments, matchFragment, opts) {
        if (!settingsRoot || !fragments || !fragments.length) return;
        var all = translateSettingsLeaves(settingsRoot, opts && opts.selector);
        for (var i = 0; i < all.length; i++) {
            var el = all[i];
            if (shouldSkipEditorElement(el)) continue;
            var text = normalizeText(el.textContent || '');
            if (!text || (opts && opts.maxLen && text.length > opts.maxLen)) continue;
            if (matchFragment(text)) replaceTextNodeFragments(el, fragments);
        }
    }

    function translateSettingsTextRules(settingsRoot, textRules, opts) {
        if (!settingsRoot || !textRules || !textRules.length) return;
        var all = translateSettingsLeaves(settingsRoot, opts && opts.selector);
        for (var i = 0; i < all.length; i++) {
            var el = all[i];
            if (shouldSkipEditorElement(el)) continue;
            var text = normalizeText(el.textContent || '');
            if (!text) continue;
            for (var g = 0; g < textRules.length; g++) {
                if (textRules[g].test(text, el)) {
                    textRules[g].apply(el, text);
                    break;
                }
            }
        }
    }

    function translateScopeAttributesAndHints(scopes, hints, opts) {
        opts = opts || {};
        var selector = opts.selector || 'span, div, button, label';
        for (var s = 0; s < scopes.length; s++) {
            var scope = scopes[s];
            if (!scope || scope.closest('.monaco-editor .view-lines')) continue;
            updateAttributeHints(scope, hints, opts.attrs);
            var nodes = scope.querySelectorAll ? scope.querySelectorAll(selector) : [];
            for (var n = 0; n < nodes.length; n++) {
                var el = nodes[n];
                if (el.closest('.monaco-editor .view-lines')) continue;
                if (opts.skipMultiChild &&
                    el.querySelector('span, div, button') &&
                    el.childElementCount > 1) continue;
                updateAttributeHints(el, hints, opts.attrs);
                updateLeafTextHints(el, hints, opts);
            }
        }
    }

    function stripWarningSymbol(text) {
        if (!text) return '';
        return text.replace(/^[\u26A0\uFE0F\u26A0]\s*/u, '').trim();
    }

    function getCursorSettingsRoot() {
        if (!document.querySelector(
            '.cursor-settings-cell, .cursor-settings-section, [class*="cursor-settings"]'
        )) return null;
        return getSettingsRoot();
    }

    function getSettingsDescriptionConfig() {
        return {
            symlinkZh: SETTINGS_SYMLINK_TEXT,
            symlinkZhAdmin: SETTINGS_SYMLINK_ADMIN_TEXT,
            symlinkTail: SETTINGS_SYMLINK_TAIL,
            mcpFragments: SETTINGS_MCP_FRAGMENTS,
            domainFragments: SETTINGS_DOMAIN_FRAGMENTS
        };
    }

    function translateSettingsDescription(root, cfg) {
        if (!root || !cfg) return;
        var descSelector = cfg.descSelector ||
            '.cursor-settings-cell-description, .cursor-settings-section-header-description, ' +
            '[class*="cursor-settings"] [class*="description"], ' +
            '[class*="cursor-settings"] [class*="subtitle"], [class*="cursor-settings"] p';
        var descs = root.querySelectorAll(descSelector);
        for (var i = 0; i < descs.length; i++) {
            var el = descs[i];
            if (el.closest('.monaco-editor .view-lines')) continue;
            var raw = el.textContent || '';
            if (!raw || raw.length > (cfg.maxLen || 500)) continue;
            var text = normalizeText(raw);
            var plain = stripWarningSymbol(text);
            var tr = lookupTranslation(raw) || lookupTranslation(text) || lookupTranslation(plain) ||
                replacePartialText(raw) || replacePartialText(plain);
            if (!tr && plain.indexOf('Skip symlinks during') >= 0 && plain.indexOf('Use with caution') >= 0) {
                tr = plain.indexOf('(controlled by admin)') >= 0
                    ? (cfg.symlinkZhAdmin + cfg.symlinkTail)
                    : (cfg.symlinkZh + cfg.symlinkTail);
            }
            if (!tr && plain.indexOf('MCP tools that can run automatically') >= 0) {
                if (el.childElementCount > 0) {
                    replaceTextNodeFragments(el, cfg.mcpFragments);
                    continue;
                }
                tr = replacePartialText(raw) || replacePartialText(plain);
            }
            if (!tr && plain.indexOf('Domains that Agent can fetch from automatically') >= 0) {
                if (el.childElementCount > 0) {
                    replaceTextNodeFragments(el, cfg.domainFragments);
                    continue;
                }
                tr = replacePartialText(raw) || replacePartialText(plain);
            }
            if (tr && normalizeText(raw) !== normalizeText(tr)) {
                el.textContent = tr;
            }
        }
    }

    function getSettingsDescriptionConfig() {
        return {
            symlinkZh: SETTINGS_SYMLINK_TEXT,
            symlinkZhAdmin: SETTINGS_SYMLINK_ADMIN_TEXT,
            symlinkTail: SETTINGS_SYMLINK_TAIL,
            mcpFragments: SETTINGS_MCP_FRAGMENTS,
            domainFragments: SETTINGS_DOMAIN_FRAGMENTS
        };
    }

    function translateSettingsLabel(root) {
        if (!root) return;
        var labels = root.querySelectorAll(
            '.cursor-settings-cell-label, .cursor-settings-section-header-title, ' +
            '[class*="cursor-settings"] h1, [class*="cursor-settings"] h2, [class*="cursor-settings"] h3, ' +
            '[class*="cursor-settings"] [class*="title"], [class*="cursor-settings"] [class*="label"]'
        );
        for (var j = 0; j < labels.length; j++) {
            translateAttributes(labels[j]);
            var lraw = normalizeText(labels[j].textContent || '');
            if (!lraw) continue;
            var ltr = lookupTranslation(lraw) || replacePartialText(lraw);
            if (ltr && ltr !== lraw) {
                if (labels[j].childElementCount > 0) {
                    replaceTextNodeFragments(labels[j], [[lraw, ltr]]);
                } else {
                    labels[j].textContent = ltr;
                }
            }
        }
    }

    var SETTINGS_SYMLINK_FRAGMENTS = [
        ['Use with caution.', '谨慎使用。'],
        ['Skip symlinks during', '在 .cursorignore 文件发现期间跳过符号链接。'],
        ['Only enable if your repository has many symlinks', '仅在您的仓库有很多符号链接时启用'],
        ['Changing this setting will require a restart of Cursor.', '更改此设置需要重启 Cursor。']
    ];

    function translateSettingsSymlinkDescription(settingsRoot, opts) {
        if (!settingsRoot) return;
        opts = opts || {};
        var descSelector = opts.descSelector ||
            '.setting-item-description, .settings-description, .cursor-settings-cell-description, ' +
            '[class*="setting"] p, [class*="settings"] p, div, span, p, label';
        var descs = settingsRoot.querySelectorAll(descSelector);
        for (var di = 0; di < descs.length; di++) {
            var del = descs[di];
            if (shouldSkipEditorElement(del)) continue;
            var draw = del.textContent || '';
            var dtext = normalizeText(draw);
            if (!dtext || dtext.length > (opts.maxLen || 400)) continue;
            if (dtext.indexOf('Use with caution') === -1 || dtext.indexOf('Skip symlinks') === -1) continue;
            var dplain = stripWarningSymbol(dtext);
            var dtr = lookupTranslation(draw) || lookupTranslation(dtext) || lookupTranslation(dplain) ||
                replacePartialText(dplain);
            if (dtr && normalizeText(draw) !== normalizeText(dtr)) del.textContent = dtr;
        }
    }

    function translateSettingsLeafFragments(settingsRoot, fragments, opts) {
        if (!settingsRoot || !fragments || !fragments.length) return;
        opts = opts || {};
        var all = settingsRoot.querySelectorAll(opts.selector || 'div, span, p, label');
        for (var i = 0; i < all.length; i++) {
            var el = all[i];
            if (shouldSkipEditorElement(el)) continue;
            if (el.querySelector('div, span, p, label, button')) continue;
            var text = normalizeText(el.textContent || '');
            if (!text || text.length > (opts.maxLen || 200)) continue;
            if (/^[a-z][\w-]*(?:\.[A-Za-z][\w-]*){1,}$/i.test(text)) continue;
            if (text.indexOf('Use with caution') !== -1 && text.indexOf('Skip symlinks') !== -1) {
                replaceTextNodeFragments(el, SETTINGS_SYMLINK_FRAGMENTS);
                continue;
            }
            replaceTextNodeFragments(el, fragments);
        }
    }

    function shouldSkipSubtreeElement(el) {
        if (!el || el.nodeType !== 1) return false;
        if (isProtectedContent(el)) return true;
        if (el.classList && el.classList.contains('monaco-editor')) return true;
        try {
            if (el.closest('.monaco-editor')) return true;
            if (el.closest('webview')) return true;
            if (el.closest('.menubar, [role="menubar"], .menubar-menu-title, .menubar-menu-button')) return true;
            if (el.matches && el.matches(
                '.view-lines, .editor-scrollable, .overflow-guard, .inputarea, .margin, .minimap'
            )) return true;
        } catch (e) {}
        return false;
    }

    function getTranslationSubtreeRoot() {
        var roots = [];
        var seen = new Set();
        function pushRoot(el) {
            if (!el || seen.has(el)) return;
            seen.add(el);
            roots.push(el);
        }
        var wb = document.querySelector('.monaco-workbench');
        if (wb) {
            var parts = wb.children;
            for (var i = 0; i < parts.length; i++) pushRoot(parts[i]);
            if (!roots.length) pushRoot(wb);
        }
        var floats = document.querySelectorAll(
            'body > .context-view, body > .monaco-hover, body > .monaco-menu-container, ' +
            'body > .monaco-select-box-dropdown-container, body > .quick-input-widget'
        );
        for (var f = 0; f < floats.length; f++) pushRoot(floats[f]);
        if (!roots.length && document.body) pushRoot(document.body);
        return roots;
    }

    function translateSubtreeRegions() {
        var roots = getTranslationSubtreeRoot();
        for (var i = 0; i < roots.length; i++) {
            try { translateSubtree(roots[i]); } catch (e) {}
        }
    }
