    // ================================================================
    // SECTION 3: 初始化
    // ================================================================

    function initializeLocalization() {
        var target = document.documentElement || document.body;
        if (!target) { setTimeout(initializeLocalization, 50); return; }

        var localizationObserver = new MutationObserver(handleMutations);
        localizationObserver.observe(target, { childList: true, subtree: true });
        try { installPlaceholderHook(); } catch (e) {}
        try { installSettingsDropdownObserver(); } catch (e) {}
        try { installMonacoHoverTranslation(); } catch (e) {}
        try { installBrowserWebviewObserver(); } catch (e) {}
        try { installDynamicMenuObserver(); } catch (e) {}
        try { installMenubarObserver(); } catch (e) {}
        try { installAuxiliaryWindowTranslation(); } catch (e) {}

        setTimeout(function() {
            if (document.body) {
                try { translateSubtreeRegions(); } catch (e) {}
                try { queueMenubarTranslation(); } catch (e) {}
                try { localizeCommitScores(); } catch (e) {}
                queueGlobalTranslation(true);
            }
        }, 500);

        setTimeout(function() {
            if (document.body) {
                try { translateSubtreeRegions(); } catch (e) {}
                try { localizeCommitScores(); } catch (e) {}
                queueGlobalTranslation(true);
            }
        }, 2500);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeLocalization);
    } else {
        initializeLocalization();
    }
})();
