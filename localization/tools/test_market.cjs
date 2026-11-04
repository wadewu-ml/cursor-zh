const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const engine = fs.readFileSync(path.join(root, 'runtime/engine.js'), 'utf8');
const market = fs.readFileSync(path.join(root, 'runtime/market.js'), 'utf8');
const core = JSON.parse(fs.readFileSync(path.join(root, 'Core_Dictionary.json'), 'utf8'));
const dictionary = new Map(core.sections.flatMap(s => s.entries).concat(core.entries || []));
const payload = JSON.parse(fs.readFileSync(path.join(root, 'Plugin_Marketplace_Dictionary.json'), 'utf8'));
payload.patterns = payload.patterns.map(p => Array.isArray(p)
    ? [new RegExp(p[0], p[2] ?? 'i'), p[1]]
    : [new RegExp(p.regex, p.flags ?? 'i'), p.replace ?? p.replacement]);

function load(context, start, end) {
    const from = engine.indexOf(start), to = engine.indexOf(end, from);
    assert.ok(from >= 0 && to > from, `missing runtime fragment: ${start}`);
    vm.runInContext(engine.slice(from, to), context);
}

function fixture(storageValues = {}) {
    let walked = 0;
    let candidates = [];
    const frames = [];
    const storage = new Map(Object.entries(storageValues));
    const context = vm.createContext({
        Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 }, NodeFilter: { SHOW_TEXT: 4 },
        localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
        lookupTranslation: s => dictionary.get(s), replacePartialText: () => null,
        getMarketplaceDictionaryPayload: () => payload,
        requestAnimationFrame: fn => frames.push(fn),
        document: {
            // Reading all conversation text to detect the market is unnecessary work.
            body: { get textContent() { throw new Error('read unrelated document text'); } },
            querySelectorAll(selector) {
                assert.equal(selector, context.MARKETPLACE_SELECTOR);
                return candidates;
            },
            createTreeWalker(root) {
                assert.ok(root.nodes, 'walked outside a market root');
                let i = 0;
                return { nextNode() { if (i === root.nodes.length) return null; walked++; return root.nodes[i++]; } };
            }
        }
    });
    load(context, '    var SKIP_SELECTOR', '    function normalizeQuotes');
    load(context, '    function isPromptBarRegion(', '    function isQuickInputRegion(');
    load(context, '    function isTranslatableTimeline(', '    function shouldSkipEditorElement(');
    load(context, '    var MARKETPLACE_SELECTOR', '    function nodeHasBrowser(');
    vm.runInContext(market, context);
    function element(marker = '', scope = null) {
        return {
            nodeType: 1, tagName: 'SPAN', isContentEditable: marker === '[contenteditable]',
            parentElement: scope,
            closest(selector) {
                if (marker && selector.includes(marker)) return this;
                if (selector === context.MARKETPLACE_SELECTOR) return scope;
                return null;
            }
        };
    }
    const panel = element();
    panel.nodes = [];
    panel.closest = selector => selector === context.MARKETPLACE_SELECTOR ? panel : null;
    function text(value, marker = '', scope = panel) {
        const node = { nodeType: 3, textContent: value, parentElement: element(marker, scope) };
        if (scope === panel) panel.nodes.push(node);
        return node;
    }
    return { context, panel, text, element, frames, storage, walked: () => walked,
        setCandidates: roots => { candidates = roots; } };
}

async function main() {
    const f = fixture();
    assert.equal(f.context.marketplaceTranslationEnabled, true);
    assert.equal(f.context.marketplaceOnlineTranslationEnabled, false);
    const configured = fixture({ 'cursor-zh.marketplace.enabled': '0', 'cursor-zh.marketplace.online': '1' });
    assert.equal(configured.context.marketplaceTranslationEnabled, false);
    assert.equal(configured.context.marketplaceOnlineTranslationEnabled, true);
    const cachedText = 'A previously translated marketplace description';
    f.storage.set('cursor-zh.marketplace.cache.' + cachedText, '已缓存的市场描述');
    const cachedNode = f.text(cachedText, '', null);
    f.context.fetch = () => { throw new Error('cache hit made a network request'); };
    f.context.translateMarketplaceOnline(cachedNode, cachedText);
    assert.equal(cachedNode.textContent, '已缓存的市场描述');
    assert.equal(cachedNode.__cursorZhMarketplaceOriginal, cachedText);
    // Neither unrelated labels nor long chat histories should be scanned or rewritten.
    const background = Array.from({ length: 5000 }, () => f.text('Datadog', '', null));
    f.context.localizeMarketplace();
    assert.equal(f.walked(), 0);
    assert.ok(background.every(n => n.textContent === 'Datadog'));

    const name = f.text('Datadog');
    const label = f.text('All Plugins');
    const protectedNodes = ['.assistant-message', '.agent-transcript-row-markdown',
        '.composer-human-message-content', '[data-message-kind="assistant"]',
        '[data-agent-transcript-human-bubble]', '.monaco-editor', '[contenteditable]']
        .map(marker => f.text('Datadog', marker));
    const nestedPanel = f.element('', f.panel);
    const protectedPanel = f.element('.assistant-message');
    f.setCandidates([f.panel, nestedPanel, protectedPanel]);
    f.context.localizeMarketplace();
    assert.equal(name.textContent, 'Datadog（监控观测）');
    assert.equal(label.textContent, dictionary.get('All Plugins'));
    assert.ok(protectedNodes.every(n => n.textContent === 'Datadog'));
    assert.equal(f.walked(), f.panel.nodes.length * 2, 'nested roots were traversed more than once per pass');

    label.textContent = 'Suggested';
    name.textContent = 'Figma';
    f.context.localizeMarketplace();
    assert.equal(label.textContent, dictionary.get('Suggested'));
    assert.equal(name.textContent, 'Figma（设计协作）');
    f.context.marketplaceTranslationEnabled = false;
    f.context.localizeMarketplace();
    assert.equal(label.textContent, 'Suggested');
    assert.equal(name.textContent, 'Figma');
    label.textContent = 'New content while translation is off';
    f.context.localizeMarketplace();
    assert.equal(label.textContent, 'New content while translation is off');

    // A delayed online response must not replace newer UI content.
    f.context.marketplaceTranslationEnabled = true;
    const pending = f.text('An unfamiliar sentence with no known dictionary entry');
    const pendingOriginal = pending.textContent;
    pending.__cursorZhMarketplaceOriginal = pending.textContent;
    let resolve;
    f.context.fetch = () => new Promise(done => { resolve = done; });
    f.context.translateMarketplaceOnline(pending, pending.textContent);
    pending.textContent = 'A newly rendered sentence';
    resolve({ json: async () => [[['旧内容译文']]] });
    await new Promise(setImmediate);
    assert.equal(pending.textContent, 'A newly rendered sentence');
    assert.equal(f.storage.get('cursor-zh.marketplace.cache.' + pendingOriginal), '旧内容译文');

    // Repeated mutations of one node need one queue entry and one translation pass.
    load(f.context, '    var pendingNodes', '    function mergeGlobalTaskFlags(');
    load(f.context, '    function enqueueNode(', '    function queueGlobalTranslation(');
    load(f.context, '    function runBatchTranslation(', '    function nodeHasSelectionTools(');
    let translated = 0;
    f.context.translateSubtree = () => { translated++; };
    f.context.collectBatchTaskFlags = () => 0;
    for (let i = 0; i < 10000; i++) {
        f.context.enqueueNode(label);
        f.context.enqueueNode(protectedNodes[0]);
    }
    assert.equal(vm.runInContext('pendingNodes.size', f.context), 1);
    assert.equal(f.frames.length, 1);
    f.frames[0]();
    assert.equal(translated, 1);
    assert.equal(vm.runInContext('pendingNodes.size', f.context), 0);
    console.log('PASS: market scope, protected content, node reuse, delayed responses, and mutation queue');
    console.log('Workload: 5000 unrelated nodes skipped; 10000 repeated mutations translate once');
}
main().catch(err => { console.error(err); process.exitCode = 1; });
