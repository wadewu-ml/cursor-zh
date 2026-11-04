const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'runtime/engine.js'), 'utf8');
const dictionary = new Map(JSON.parse(fs.readFileSync(path.join(root, 'Core_Dictionary.json'), 'utf8'))
    .sections.flatMap(section => section.entries));
const context = vm.createContext({
    Node: { TEXT_NODE: 3 },
    lookupTranslation: text => dictionary.get(text),
    replacePartialText: () => null,
    SKIP_TAGS: new Set(['INPUT', 'TEXTAREA']),
    isTranslatableTimeline: () => false,
    SKIP_SELECTOR: '.monaco-editor'
});
function load(name, next, start) {
    vm.runInContext(source.slice(source.indexOf(start || ('    function ' + name + '(')),
        source.indexOf('    function ' + next + '(')), context);
}
load('isProtectedContent', 'normalizeText', '    var PROTECTED_CONTENT_SELECTOR');
load('isPromptBarRegion', 'isQuickInputRegion');
load('isEditorRegion', 'shouldSkipEditorElement');
load('translatePromptBarText', 'translatePromptBarTextNode');
load('translatePromptBarTextNode', 'runPromptBarTranslation');
function element(editable) {
    return {
        tagName: 'P', isContentEditable: editable, textContent: 'Send',
        closest(selector) {
            if (selector.includes('.prompt-bar-container')) return this;
            if (editable && selector.includes('[contenteditable]')) return this;
            return null;
        }
    };
}
for (const editable of [true, false]) {
    const parent = element(editable);
    const text = { nodeType: 3, parentElement: parent, textContent: 'Send' };
    context.translatePromptBarTextNode(text);
    context.translatePromptBarText(parent, 80);
    assert.equal(text.textContent, editable ? 'Send' : dictionary.get('Send'));
    assert.equal(parent.textContent, editable ? 'Send' : dictionary.get('Send'));
    assert.equal(context.isEditorRegion(text), editable);
}
// Read-only conversation bodies (model replies, sent user messages) stay untouched.
for (const marker of ['.assistant-message', '.agent-transcript-row-markdown', '[data-message-kind="assistant"]',
    '.composer-human-message-content', '[data-agent-transcript-human-bubble]']) {
    const body = {
        tagName: 'P', isContentEditable: false, textContent: 'Send',
        closest(selector) {
            if (selector.includes('.prompt-bar-container')) return this;
            if (selector.includes(marker)) return this;
            return null;
        }
    };
    const text = { nodeType: 3, parentElement: body, textContent: 'Send' };
    context.translatePromptBarTextNode(text);
    context.translatePromptBarText(body, 80);
    assert.equal(text.textContent, 'Send', marker);
    assert.equal(body.textContent, 'Send', marker);
    assert.equal(context.isEditorRegion(text), true, marker);
}
console.log('PASS: editable text and chat bodies are protected; UI labels still translate');
