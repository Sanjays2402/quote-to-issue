# Roadmap

This file is the agent's task queue. Unchecked items get implemented in order. When all items are checked, the agent appends a new batch of 10.

- [x] MV3 manifest + service worker scaffolding
- [x] Context menu: 'File as GitHub issue' on selection
- [x] Capture selection text + page URL + page title
- [x] Popup form: repo owner/name, labels, body preview
- [x] Personal access token storage (chrome.storage.local, encrypted)
- [x] POST to GitHub issues API with markdown body
- [x] Auto-screenshot of visible tab attached as image
- [x] Multi-repo support with recent-repos dropdown
- [x] Issue templates per repo
- [x] Draft mode: save locally before posting
- [x] Bulk-file from multiple selections on one page
- [x] Liquid-glass popup UI
- [x] Dark/light theme
- [x] Markdown preview pane
- [x] Auto-link source URL with line/paragraph anchor
- [x] Keyboard shortcut to file issue without opening popup
- [x] Quick-repo switcher with fuzzy search in popup
- [x] Issue title auto-suggestion from selection (first sentence, smart truncate)
- [x] Surrounding-context capture (N chars before/after selection) toggle
- [x] Author/byline + publish date scraping for news/blog pages
- [x] Code block detection: wrap selections from <pre>/<code> as fenced markdown
- [x] Recent-issues panel: list last 10 issues filed, click to reopen on GitHub
- [x] Per-repo default labels + assignees with chip editor
- [x] Settings page with liquid-glass design and token rotation
- [x] Offline queue: retry failed POSTs when connectivity returns
- [x] Duplicate-issue detector: search repo for similar open issues before filing
- [x] Issue body templates with variables ({{url}}, {{selection}}, {{title}}, {{date}})
- [x] OAuth device-flow login as alternative to PAT
- [x] Per-repo issue type picker (bug/feature/question) with matching label presets
- [x] Annotated screenshot: draw rectangle/arrow over capture before attaching
- [x] Highlighted-selection screenshot mode (mask page, keep selection visible)
- [x] Issue success toast with copy-link and open-in-tab actions
- [x] Quote history search: full-text search over previously filed quotes
- [x] Per-repo milestone picker populated from GitHub API
- [x] Privacy mode: scrub query params and auth tokens from captured URLs
