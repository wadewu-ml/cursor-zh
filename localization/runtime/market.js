    var MARKETPLACE_TRANSLATION_KEY = 'cursor-zh.marketplace.enabled';
    var marketplaceTranslationEnabled = true;
    try { marketplaceTranslationEnabled = localStorage.getItem(MARKETPLACE_TRANSLATION_KEY) !== '0'; } catch (e) {}
    var marketplaceOnlineTranslationEnabled = false;
    try { marketplaceOnlineTranslationEnabled = localStorage.getItem('cursor-zh.marketplace.online') === '1'; } catch (e) {}
    var onlineTranslationsThisPass = 0;

    var isMarketplaceDictionaryLoaded = false;
    var marketplacePluginNames = {};
    var marketplaceLabels = {};
    var marketplaceFragments = [];
    var marketplacePatterns = [];
    var marketplaceSkillNames = {};
    var marketplaceNameStems = {};
    var marketplaceDescriptionFragments = [];
    var pendingOnlineTranslations = new Set();

    // __PLUGIN_MARKETPLACE_BLOCK__

    function loadMarketplaceDictionary() {
        if (isMarketplaceDictionaryLoaded) return;
        if (typeof getMarketplaceDictionaryPayload !== 'function') return;
        var p = getMarketplaceDictionaryPayload();
        marketplacePluginNames = p.pluginNames || {};
        marketplaceLabels = p.uiLabels || {};
        marketplaceFragments = p.uiFragments || [];
        marketplacePatterns = p.patterns || [];
        marketplaceSkillNames = p.skillNames || {};
        marketplaceNameStems = p.nameStems || {};
        marketplaceDescriptionFragments = p.descriptionFragments || [];
        isMarketplaceDictionaryLoaded = true;
    }

    function ensureMarketplaceDictionary() {
        loadMarketplaceDictionary();
    }

    function translateMarketplaceDescription(text) {
        ensureMarketplaceDictionary();
        if (!text) return null;
        var trimmed = normalizeText(text);

        if (marketplaceLabels[trimmed]) return marketplaceLabels[trimmed];

        var dict = lookupTranslation(text);
        if (dict) return dict;

        var partialDict = replacePartialText(text);
        if (partialDict) return partialDict;

        var result = text;
        var changed = false;
        var applyPairs = function(pairs) {
            for (var i = 0; i < pairs.length; i++) {
                var pair = pairs[i];
                var neo = result.split(pair[0]).join(pair[1]);
                if (pair[0].indexOf('...') !== -1) {
                    neo = neo.split(pair[0].replace(/\.\.\./g, '…')).join(pair[1].replace(/\.\.\./g, '…'));
                }
                if (neo !== result) {
                    result = neo;
                    changed = true;
                }
            }
        };
        applyPairs(marketplaceFragments);
        applyPairs(marketplaceDescriptionFragments);

        var normalized = normalizeText(result);
        for (var j = 0; j < marketplacePatterns.length; j++) {
            var mp = marketplacePatterns[j];
            if (mp[0].test(result)) {
                result = result.replace(mp[0], mp[1]);
                changed = true;
            } else if (normalized !== result && mp[0].test(normalized)) {
                result = normalized.replace(mp[0], mp[1]);
                changed = true;
            }
        }
        applyPairs(marketplaceFragments);

        if (!changed && /^[\s\w.-]+$/.test(trimmed) && trimmed.length < 60 && trimmed.indexOf(' ') === -1) return null;
        return changed ? result : null;
    }

    function isTranslatedMarketplaceText(text) {
        return !!(text && /[\u4e00-\u9fff]/.test(text));
    }

    function isMarketplaceEnglishDescription(text) {
        if (!text) return false;
        var trimmed = normalizeText(text);
        if (trimmed.length < 18 || trimmed.length > 500) return false;
        if (/[\u4e00-\u9fff]/.test(trimmed)) return false;
        if (!/[A-Za-z]/.test(trimmed) || trimmed.indexOf(' ') === -1) return false;
        if (/^[\w.-]+$/.test(trimmed)) return false;
        if (/^(Search|Get|Add to Cursor|Browse Marketplace|Suggested|Featured|Documentation)$/i.test(trimmed)) return false;
        return true;
    }

    function translateMarketplaceOnline(node, original) {
        if (!isMarketplaceEnglishDescription(original)) return;
        if (isTranslatedMarketplaceText(node.textContent || '')) return;
        if (onlineTranslationsThisPass >= 8) return;
        var locale = localizationLocale;
        var key = 'cursor-zh.marketplace.cache.' + (locale === 'zh-cn' ? '' : locale + '.') + original;
        var cached = null;
        try { cached = localStorage.getItem(key); } catch (e) {}
        if (cached) {
            node.__cursorZhMarketplaceOriginal = original;
            node.__cursorZhMarketplaceTranslation = cached;
            node.textContent = cached;
            return;
        }
        if (pendingOnlineTranslations.has(original)) return;
        pendingOnlineTranslations.add(original);
        onlineTranslationsThisPass++;

        var url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=' + (locale === 'zh-tw' ? 'zh-TW' : 'zh-CN') + '&dt=t&q=' + encodeURIComponent(original);
        fetch(url)
            .then(function(resp) { return resp.json(); })
            .then(function(data) {
                var parts = data && data[0] ? data[0] : [];
                var translated = '';
                for (var i = 0; i < parts.length; i++) {
                    if (parts[i] && parts[i][0]) translated += parts[i][0];
                }
                translated = translated.trim();
                if (!translated || translated === original || !/[\u4e00-\u9fff]/.test(translated)) return;
                try { localStorage.setItem(key, translated); } catch (e) {}
                if (marketplaceTranslationEnabled && !isEditorRegion(node) &&
                    nodeHasMarketplace(node.parentElement) &&
                    getMarketplaceOriginalText(node) === original && node.textContent === original) {
                    node.__cursorZhMarketplaceTranslation = translated;
                    node.textContent = translated;
                }
            })
            .catch(function() {})
            .finally(function() { pendingOnlineTranslations.delete(original); });
    }

    function inferPluginTranslation(name) {
        ensureMarketplaceDictionary();
        if (!name || name.indexOf(' ') !== -1 || name.indexOf('（') !== -1) return null;
        if (!/[-_]/.test(name)) return null;
        var parts = name.toLowerCase().split(/[-_]+/);
        var out = [];
        for (var i = 0; i < parts.length; i++) {
            var word = marketplaceNameStems[parts[i]];
            if (word) out.push(word);
        }
        if (out.length < 2) return null;
        var joined = out.join(' ');
        return joined.length > 0 ? joined : null;
    }

    function getMarketplaceRoots() {
        var candidates = document.querySelectorAll(MARKETPLACE_SELECTOR);
        var roots = [];
        for (var i = 0; i < candidates.length; i++) {
            var el = candidates[i];
            if (isEditorRegion(el)) continue;
            if (el.parentElement && nodeHasMarketplace(el.parentElement)) continue;
            roots.push(el);
        }
        return roots;
    }

    function walkMarketplaceText(callback, roots) {
        for (var r = 0; r < roots.length; r++) {
            var walker = document.createTreeWalker(roots[r], NodeFilter.SHOW_TEXT, null);
            var node;
            while ((node = walker.nextNode())) {
                if (isEditorRegion(node)) continue;
                var parent = node.parentElement;
                if (!parent) continue;
                if (parent.closest('input, textarea, select, [contenteditable="true"]')) continue;
                callback(node);
            }
        }
    }

    // React may reuse a text node for another item while a translation is cached or pending.
    function getMarketplaceOriginalText(node) {
        var text = node.textContent || '';
        if (text !== node.__cursorZhMarketplaceOriginal && text !== node.__cursorZhMarketplaceTranslation) {
            delete node.__cursorZhMarketplaceOriginal;
            delete node.__cursorZhMarketplaceTranslation;
        }
        return node.__cursorZhMarketplaceOriginal || text;
    }

    function localizeMarketplace() {
        var roots = getMarketplaceRoots();
        if (!roots.length) return;
        ensureMarketplaceDictionary();
        onlineTranslationsThisPass = 0;
        walkMarketplaceText(function(node) {
            var original = getMarketplaceOriginalText(node);
            if (marketplaceTranslationEnabled) {
                if (node.__cursorZhMarketplaceTranslation && node.textContent === node.__cursorZhMarketplaceTranslation) return;
                var translated = translateMarketplaceDescription(original);
                if (translated && translated !== node.textContent) {
                    node.__cursorZhMarketplaceOriginal = original;
                    node.__cursorZhMarketplaceTranslation = translated;
                    node.textContent = translated;
                } else if (!isTranslatedMarketplaceText(original)) {
                    node.__cursorZhMarketplaceOriginal = original;
                    if (marketplaceOnlineTranslationEnabled) translateMarketplaceOnline(node, original);
                }
            } else if (node.__cursorZhMarketplaceOriginal) {
                node.textContent = node.__cursorZhMarketplaceOriginal;
            }
        }, roots);
        localizeMarketplaceNames(roots);
    }

    function appendTranslatedName(text, map) {
        if (!text || text.indexOf('（') !== -1) return null;
        var key = normalizeText(text);
        var cn = map[key] || inferPluginTranslation(key);
        if (!cn) return null;
        return text + '（' + cn + '）';
    }

    function localizeMarketplaceNames(roots) {
        ensureMarketplaceDictionary();
        if (!marketplaceTranslationEnabled) return;
        walkMarketplaceText(function(node) {
            var text = node.textContent || '';
            var trimmed = normalizeText(text);
            if (!trimmed || trimmed.length > 80) return;

            var pluginName = appendTranslatedName(text, marketplacePluginNames);
            if (pluginName) {
                node.__cursorZhMarketplaceOriginal = text;
                node.__cursorZhMarketplaceTranslation = pluginName;
                node.textContent = pluginName;
                return;
            }

            var skillName = appendTranslatedName(text, marketplaceSkillNames);
            if (skillName) {
                node.__cursorZhMarketplaceOriginal = text;
                node.__cursorZhMarketplaceTranslation = skillName;
                node.textContent = skillName;
            }
        }, roots);
    }
