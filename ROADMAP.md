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
- [ ] Author/byline + publish date scraping for news/blog pages
- [ ] Code block detection: wrap selections from <pre>/<code> as fenced markdown
- [ ] Recent-issues panel: list last 10 issues filed, click to reopen on GitHub
- [ ] Per-repo default labels + assignees with chip editor
- [ ] Settings page with liquid-glass design and token rotation
- [ ] Offline queue: retry failed POSTs when connectivity returns
