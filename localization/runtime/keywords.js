    // Keyword groups shared by document and settings localization guards.

    var DOCUMENT_KEYWORD_GROUPS = {
        FEATURE_PROMOTIONS: [
            'multitask', 'Parallelize', 'Get Unblocked', 'Coordinate parallel', 'Try now in Cursor',
            'Cloud Agents, and more', 'unlimited Tab', 'Refactor code generator', "You've hit your usage limit",
            'Usage limit reached', 'Get faster responses', 'Responses may be slower',
            'Increase limits for faster', 'out of usage', 'ask your admin',
            'Total usage limit reached', 'on-demand limit', 'Upgrade to Pro+', 'Set new limit',
            'Smartest Model Yet', '50% Off Through', 'Try Grok',
            'use subagents to break down tasks',
            'Plan Update', '2x Included Usage', 'High Load', 'high demand right now',
            'Connect GitHub to Cursor', 'Let agents work with your Repos',
            'have moved to Customize', 'new home for all the ways'
        ],
        WELCOME: [
            'Sign in', 'Log in', 'Sign Up', 'Sign up', 'The best way to code with AI',
            'Open Project', 'Clone Repository', 'Connect via SSH',
            'Remote Machines', 'Publish to GitHub', 'Report Issue', 'Send Feedback', 'Code Intelligence',
            'Click to import all local VS Code extensions', "don't show again", 'Log in to use Cursor AI features',
            'Repositories', 'Message Cursor', 'Browse Files', 'No workspace folder open',
            'Close Pane', 'Unable to load automations', "Let's kick something off",
            'Getting Started', 'Teach Cursor New Skills', 'have moved to Customize'
        ],
        SHADOWS_AND_BLUR: [
            'Shadow & Blur', '阴影与模糊', 'Drop shadow', 'Inner shadow', 'Layer Blur', 'Backdrop Blur',
            'Add shadow or blur', 'Remove shadow', 'Adjust shadow', 'Hide drop shadow', 'Show drop shadow',
            'css-effects-type-select', 'css-inspector-section'
        ],
        DESIGN_PANEL: [
            'Stops', 'Ellipse', 'Solid', 'Linear', 'Radial', 'Conic', 'Circle', 'Fixed Width', 'Fit contents', 'Fill container',
            'Shadow & Blur', 'Drop shadow', 'Inner shadow', 'Layer Blur', 'Backdrop Blur', 'Add shadow or blur'
        ],
        UPGRADE_PROMPTS: [
            'Upgrade for extended', 'Upgrade to Pro', 'extended limits', 'upgrade-pro',
            'Cloud Agents, and more', 'usage limit', 'unlimited Tab', "You've hit your usage limit",
            'Usage limit reached', 'Get faster responses', 'Responses may be slower',
            'Increase limits for faster', 'out of usage', 'ask your admin',
            'Total usage limit reached', 'on-demand limit', 'Upgrade to Pro+', 'Set new limit',
            'Get Cursor Pro for more Agent usage', 'Plan Update', 'Included Usage'
        ],
        AGENT_FEEDBACK: [
            'How did the agent do', 'Misunderstood task', 'Ignored constraint', 'Wrong scope',
            'Visually hard to read', 'Wrote too much', 'Explanation not trustworthy', 'Add a comment'
        ],
        AGENT_CHANGES: [
            'All Changes', 'Pending Changes', 'Changes waiting to be confirmed', 'Keep Ctrl', ' of ',
            'Undo File', 'Keep File', 'Accept all changes', 'Keep all changes', 'Keep changes', 'Review Next File',
            'No Uncommitted Changes', 'Branch Commits', 'Find in Changes', 'Refresh Changes'
        ],
        MENTION_MENU: [
            'Files & Folders', 'Past Chats', 'Terminals', 'Mentions', 'Branch (Diff with Main)',
            'No available options', 'Changes from current branch',
            '文件和文件夹', '历史对话', '分支（与主分支的差异）', '提及', '暂无可用选项'
        ],
        AGENT_MODES: [
            'Switch Agent Mode', 'Switch Model', 'Multitask', 'Systematically diagnose',
            'Ask Cursor questions', 'Using ', 'Plan, search',
            'implementation plan', 'root cause of an issue', 'Orchestrate multiple subagents',
            'without making edits', 'Search skills, context'
        ],
        BROWSER_URL: [
            'Enter a URL above', 'instruct the Agent', 'Enter URL or search', 'Search or enter URL'
        ],
        BROWSER_TOOLS: [
            'Take Screenshot', 'Hard Reload', 'Clear Browsing History', 'Clear Cookies', 'Clear Cache',
            'Capture Area', 'Select element', 'Show Console', 'New Tab', 'Enter Full Screen',
            'Show Bookmark Bar', 'Inspect Element', 'Reload', 'Select All', '重新加载', '全选'
        ],
        BROWSER_ERRORS: [
            'Connection Failed', 'Connection failed', 'Restart Browser', 'Show Details', 'browser-error', 'canvas-error-view',
            'Enter a URL above', 'instruct the Agent', 'Browser', 'ERR_CONNECTION',
            'Cursor Browser', "Don't Open", 'Opening '
        ],
        MESSAGE_QUEUE: [
            'Queued', 'Send now', 'Edit queued', 'Editing queued', 'Remove from queue', 'Attached image',
            'Send After Current Message', 'Send Right Away'
        ],
        COMMIT_SCORES: [
            'Most Recent Commit Scored', 'AI-Generated:', 'Total Changes:', 'Agent Stats:', 'Tab Stats:',
            'No commit scored', 'No commit has been scored yet', '% AI'
        ]
    };

    var SETTINGS_KEYWORD_GROUPS = {
        CODEBASE: ['Embed codebase', 'Embeddings and metadata', '代码库索引', '索引新文件夹'],
        INDEXING: ['50,000 files', 'index any new folders', '索引新文件夹'],
        MODEL_SETTINGS: ['OpenAI key', 'Anthropic key', 'Google AI Studio key', 'Azure OpenAI', 'AWS Bedrock', 'DeepSeek'],
        SETTINGS_FRAGMENTS: [
            'Automation Profile', 'Natural Language Search', 'Auto Resume', 'Partial Matches', 'Continue Prompt',
            '自动mation', 'Use with caution', 'Skip symlinks', 'cursorignore', '符号链接', 'cursor-settings',
            "Don't Ask Again", 'Hidden Dialogs', 'hidden dialogs'
        ],
        ACCOUNT: ['Current Plan', 'Resets on', 'Included Usage', 'Resets', 'Window Restoration', 'Last Used Windows', 'Cursor Models', 'Other Models', 'Default Model', 'Adjust Plan', 'Usage limits reset', 'Search Cursor settings', '免费版', 'Manage', 'CURRENT']
    };

    function documentHasKeywordGroup(groupName) {
        var words = DOCUMENT_KEYWORD_GROUPS[groupName];
        if (!words || !words.length) return false;
        return documentContainsKeywords(words);
    }

    function settingsHaveKeywordGroup(groupName) {
        var words = SETTINGS_KEYWORD_GROUPS[groupName];
        if (!words || !words.length) return false;
        return settingsContainKeywords(words);
    }
