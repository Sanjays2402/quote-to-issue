# Quote to Issue

Select text on any page → file a GitHub issue with source URL, screenshot, and surrounding context.

> Status: **v0.1.0 — scaffold**. Features ship every 15 minutes via an autonomous agent. See `ROADMAP.md` for what's next.

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
