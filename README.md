# Quote to Issue

Select text on any page → file a GitHub issue with source URL, screenshot, and surrounding context.

## Features

- Context menu on any selection, plus `Alt+Shift+Q` / `Alt+Shift+B` shortcuts
- Smart rendering of selections: code blocks, task lists, and **tabular data
  as GitHub-flavored markdown tables** (detects tab-, pipe-, and comma-separated
  rows)
- Issue body templates with variables (`{{quote}}`, `{{quote_table}}`,
  `{{quote_tasklist}}`, `{{quote_code}}`, …)
- Per-repo defaults: labels, assignees, title prefix, issue type, templates
- Screenshot capture (visible tab, highlighted-selection, annotated)
- Drafts, bulk-filing from multiple selections, offline queue with retry
- Duplicate-issue detector, smart label inference, quote history search and pinning

## Install (dev)

```
git clone https://github.com/Sanjays2402/quote-to-issue.git
cd quote-to-issue
```

Then in Chrome: `chrome://extensions` → Developer mode → "Load unpacked" → select this folder.

## Permissions

- `contextMenus`
- `storage`
- `activeTab`
- `scripting`

**Host permissions:**
- `<all_urls>`

## Roadmap

- [ ] MV3 manifest + service worker scaffolding
- [ ] Context menu: 'File as GitHub issue' on selection
- [ ] Capture selection text + page URL + page title
- [ ] Popup form: repo owner/name, labels, body preview
- [ ] Personal access token storage (chrome.storage.local, encrypted)
- [ ] POST to GitHub issues API with markdown body
- [ ] Auto-screenshot of visible tab attached as image
- [ ] Multi-repo support with recent-repos dropdown
- [ ] Issue templates per repo
- [ ] Draft mode: save locally before posting
- [ ] Bulk-file from multiple selections on one page
- [ ] Liquid-glass popup UI
- [ ] Dark/light theme
- [ ] Markdown preview pane
- [ ] Auto-link source URL with line/paragraph anchor

## License

MIT — see [LICENSE](LICENSE).
