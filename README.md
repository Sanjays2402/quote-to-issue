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

## Terms & Disclaimer

By using this project you agree to the following.

- **No warranty.** This software is provided "as is", without warranty of any kind, express or implied, including merchantability, fitness for a particular purpose, and non-infringement.
- **No liability.** To the maximum extent permitted by law, the author and contributors are not liable for any claim, loss, or damage (direct, indirect, incidental, or consequential, including lost data or profits) arising from its use.
- **Your responsibility.** You use it at your own risk and are responsible for complying with the laws that apply to you.
- **Your data.** Keep backups; data loss is possible. If you process other people's personal information, you are responsible for complying with privacy laws such as US state privacy laws (e.g. CCPA), PIPEDA and Quebec's Law 25 (Canada), and the Digital Personal Data Protection Act, 2023 (India).
- **Third-party sites and tools.** This tool runs inside websites or apps made by others; use it in line with their terms.
- **Third parties.** Names, logos, APIs, and services of others belong to their owners and are used for identification only; no affiliation or endorsement is implied.
- **Your statutory rights.** Nothing here limits rights that cannot be waived by agreement, including under consumer-protection laws in the USA, Canada (including Quebec), and India (Consumer Protection Act, 2019).
- **License.** Use, copying, and distribution are governed by the [LICENSE](LICENSE) file; if anything here conflicts with it, the license controls.

## Content, Assets & Fair Use

- **Original work.** Unless noted otherwise (including below), the code, text, design, and images in this repository were created by the author.
- **Libraries, fonts, and icons.** Third-party libraries, fonts (for example Google Fonts), and icon sets belong to their creators and are used under their own licenses; see the dependency manifests and each source for terms.
- **Logos, brands, and screenshots.** Third-party names, logos, and screenshots appear only to identify or describe their products (nominative use). They remain the property of their owners and do not imply affiliation or endorsement.
- **Ideas and inspiration.** Where this project is inspired by another product, game, or idea, it is an independent implementation. It borrows only general ideas, mechanics, or styles, which are not anyone's exclusive property, and is meant to contain no third-party code or artwork used without permission.
- **Fair use and fair dealing.** Any third-party material is used in limited ways for purposes such as education, research, review, commentary, or identification, relying on fair use in the USA (17 U.S.C. § 107), fair dealing in Canada (Copyright Act, ss. 29–29.2), and fair dealing in India (Copyright Act, 1957, s. 52), where they apply.
- **Concerns and takedown requests.** If you own rights in something here and believe it is used improperly, [open an issue](https://github.com/Sanjays2402/quote-to-issue/issues) or contact the author through their GitHub profile with a link to the material and your claim. It will be reviewed promptly and credited, changed, or removed as appropriate. You may also use GitHub's DMCA process.
- **Contributions.** By contributing, you confirm you have the right to submit your contribution and agree it is licensed under this repository's license.
