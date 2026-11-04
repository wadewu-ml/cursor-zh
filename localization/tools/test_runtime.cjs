const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const source = fs.readFileSync(process.argv[2], 'utf8');
const root = path.resolve(__dirname, '..');
const core = JSON.parse(fs.readFileSync(path.join(root, 'Core_Dictionary.json'), 'utf8'));
const notifications = JSON.parse(fs.readFileSync(path.join(root, 'Ad_Popup_Dictionary.json'), 'utf8'));
const expected = new Map(core.sections.flatMap(section => section.entries).concat(core.entries || []));
for (const [key, value] of Array.isArray(notifications.entries)
    ? notifications.entries : Object.entries(notifications.entries)) expected.set(key, value);
if (process.argv[3] === 'zh-tw') {
    const translations = JSON.parse(fs.readFileSync(path.join(root, '../internal/core/traditional.json'), 'utf8'));
    const pattern = new RegExp(Object.keys(translations).sort((left, right) => right.length - left.length).join('|'), 'g');
    for (const [key, value] of expected) expected.set(key, value.replace(pattern, source => translations[source]));
}

const events = new Map();
const timers = [];
const frames = [];
const observations = [];
class Element {
    constructor() { this.attributes = {}; }
    setAttribute(name, value) { this.attributes[name] = value; }
}
function element() {
    return {
        nodeType: 1, tagName: 'DIV', textContent: 'Sign in', childNodes: [], children: [],
        querySelectorAll: () => [], querySelector: () => null, closest: () => null,
        getAttribute: () => null, classList: { contains: () => false },
        addEventListener() {}
    };
}
const document = {
    readyState: 'loading', body: element(), documentElement: element(),
    querySelectorAll: () => [], querySelector: () => null,
    createTreeWalker: () => ({ nextNode: () => null }),
    addEventListener: (name, callback) => events.set(name, callback)
};
document.body.firstChild = { nodeType: 3, textContent: 'Sign in', nextSibling: null };
const context = vm.createContext({
    document, Element,
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 }, NodeFilter: { SHOW_TEXT: 4 },
    MutationObserver: class {
        constructor(callback) { this.callback = callback; }
        observe(target, options) { observations.push({ target, options, callback: this.callback }); }
        disconnect() {}
    },
    localStorage: { getItem: () => null, setItem() {} },
    setTimeout: callback => { timers.push(callback); return timers.length; },
    setInterval: () => 1, clearTimeout() {}, clearInterval() {},
    requestAnimationFrame: callback => { frames.push(callback); return frames.length; },
    addEventListener() {}, open: () => null,
    fetch: () => { throw new Error('online translation must default to off'); }
});
context.window = context;

// Expose internal helpers only in the test copy of the complete generated script.
const closing = source.lastIndexOf('})();');
assert.ok(closing > 0);
vm.runInContext(source.slice(0, closing) + `
    globalThis.runtimeUnderTest = {
        translationDictionary, lookupTranslation, documentHasKeywordGroup,
        runGlobalTranslationTasks, getBrowserWebviewTranslationScript,
        marketplaceTranslationEnabled, marketplaceOnlineTranslationEnabled
    };
` + source.slice(closing), context);
const runtime = context.runtimeUnderTest;
const sortedEntries = dictionary => Array.from(dictionary, pair => Array.from(pair))
    .sort((a, b) => a[0].localeCompare(b[0]));
assert.deepEqual(sortedEntries(runtime.translationDictionary), sortedEntries(expected));
assert.equal(runtime.lookupTranslation('Send'), expected.get('Send'));
assert.equal(runtime.documentHasKeywordGroup('WELCOME'), true);
assert.equal(runtime.marketplaceTranslationEnabled, true);
assert.equal(runtime.marketplaceOnlineTranslationEnabled, false);

const input = new Element();
input.setAttribute('placeholder', 'Send');
assert.equal(input.attributes.placeholder, expected.get('Send'));
assert.equal(typeof events.get('DOMContentLoaded'), 'function');
events.get('DOMContentLoaded')();
assert.ok(observations.some(entry => entry.target === document.documentElement && entry.options.subtree));
assert.equal(context.__cursorZhPlaceholderHooked, true);
assert.equal(context.__cursorZhAuxiliaryOpenPatched, true);
for (const entry of observations) entry.callback([]);
runtime.runGlobalTranslationTasks(0xffffffff);
for (const callback of timers.slice()) callback();
for (const callback of frames.slice()) callback();
new vm.Script(runtime.getBrowserWebviewTranslationScript());
console.log(`PASS: complete runtime startup, ${expected.size} dictionary entries, keyword groups, placeholder hook, observers, and scheduled passes`);
