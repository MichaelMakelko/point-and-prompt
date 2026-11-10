<div align="center">

<img src="extension/icons/icon-128.png" alt="Pip, the point-and-prompt spider" width="112" height="112">

# point-and-prompt

**Point at your page. Say what should change. Claude Code does it.**

Chrome extension + MCP channel server that sends the element you clicked,<br>
a cropped screenshot and your request straight into your running [Claude Code](https://claude.com/claude-code) session.

[![CI](https://github.com/MichaelMakelko/point-and-prompt/actions/workflows/ci.yml/badge.svg)](https://github.com/MichaelMakelko/point-and-prompt/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-8b5cf6.svg)](LICENSE)
![Node.js 20+](https://img.shields.io/badge/node-20%2B-ec4899)
![Chrome MV3](https://img.shields.io/badge/chrome-MV3-a78bfa)

</div>

## ✨ What you get

| | |
|---|---|
| 🎯 **Element mode** | Hover, click, done. |
| ⬚ **Box mode** | Drag a rectangle over any area. |
| 💬 **Prompt in place** | Type or dictate next to the selection, `Enter` sends. |
| 📸 **Full context** | Request, URL, CSS selector, visible text, HTML and a screenshot. |
| 🗂️ **Many projects** | Each page remembers which Claude Code session it sends to. |
| 🔒 **Local only** | Everything stays on `127.0.0.1`. |

## 🚀 Quick start

Needs Claude Code with [channels](https://code.claude.com/docs/en/channels-reference) (research preview), Node.js 20+ and a Chromium browser.

```bash
# 1. Build the server
git clone https://github.com/MichaelMakelko/point-and-prompt.git
cd point-and-prompt/server && npm install && npm run build

# 2. Register it in Claude Code (once, for all projects)
claude mcp add --scope user point-and-prompt -- node /absolute/path/to/point-and-prompt/server/dist/index.js

# 3. Start Claude Code in your project with the channel enabled
claude --dangerously-load-development-channels server:point-and-prompt
```

**4.** Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked** and pick the `extension/` folder.

<details>
<summary>Tip: a short alias for the long flag</summary>

```powershell
# PowerShell: add to $PROFILE
function claudep { claude --dangerously-load-development-channels server:point-and-prompt @args }
```

```bash
# bash/zsh: add to ~/.bashrc or ~/.zshrc
alias claudep='claude --dangerously-load-development-channels server:point-and-prompt'
```

</details>

## 🖱️ Usage

1. Open your dev page on `http://localhost:<port>`.
2. Press `Alt+Shift+P`. A green dot in the toolbox means a session is connected.
3. Click an element, or press `B` and drag a box.
4. Type your request and press `Enter`. Claude answers in the terminal.

| Key | Action |
|---|---|
| `Alt+Shift+P` | Overlay on or off |
| `E` / `B` | Element mode / box mode |
| `Enter` / `Shift+Enter` | Send / new line |
| `Esc` | Cancel |

## 🔒 Security

- The server listens on `127.0.0.1` only and accepts requests only from this extension. Websites cannot send prompts.
- Scripts on the page cannot fill in or submit the overlay.
- Page content reaches Claude fenced as data, with a random ID per message.
- Still: use the overlay only on pages you trust. Screenshots stay in `<tmp>/point-and-prompt/`. Dictation sends audio to Google (Chrome Web Speech API).

Report vulnerabilities privately, see [SECURITY.md](SECURITY.md).

## 🛠️ Good to know

<details>
<summary>Troubleshooting</summary>

- **Red dot, "keine Session":** Claude Code was started without the channel flag. If you use a wrapper script, set `PNP_SKIP_FLAG_CHECK=1`.
- **"!" on the extension icon:** the overlay runs only on `http://localhost` and `http://127.0.0.1`. Reload pages that were open before installing.
- **Sent "ohne Screenshot":** Chrome refused the capture. Claude still gets selector, text and HTML.

</details>

<details>
<summary>Configuration</summary>

| Variable | Default | Purpose |
|---|---|---|
| `PNP_PORT` | `7428` | First port of the 20-port range. Also change `BASE_PORT` in `extension/background.js`. |
| `PNP_SKIP_FLAG_CHECK` | unset | `1` opens the port without checking for the channel flag. |
| `PNP_EXTENSION_ID` | fixed ID | Accept a different extension ID. |

</details>

<details>
<summary>Limitations</summary>

- `http` on localhost only, up to 20 sessions at once.
- One-way: Claude answers in the terminal, not in the overlay.
- No framework source mapping; Claude finds the code by text and selector.
- Overlay texts are in German for now.

</details>

<details>
<summary>Kurzanleitung (Deutsch)</summary>

1. `cd server && npm install && npm run build`
2. `claude mcp add --scope user point-and-prompt -- node <Pfad>/server/dist/index.js`
3. Chrome: `chrome://extensions` → Entwicklermodus → „Entpackte Erweiterung laden“ → Ordner `extension/`
4. Claude im Projektordner starten: `claude --dangerously-load-development-channels server:point-and-prompt`
5. Dev-Seite auf localhost öffnen, `Alt+Shift+P`, Element anklicken oder mit `B` einen Kasten ziehen, Wunsch tippen, `Enter`.

</details>

Want to contribute? See [CONTRIBUTING.md](CONTRIBUTING.md).

<div align="center">

[MIT](LICENSE) © Michael Makelko · not affiliated with Anthropic

</div>
