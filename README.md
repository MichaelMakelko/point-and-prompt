<div align="center">

<img src="extension/icons/icon-128.png" alt="Pip, the point-and-prompt mascot" width="96" height="96">

# point-and-prompt

**Click any element on your localhost page, say what should change, and Claude Code starts working on it.**

A Chrome extension plus an MCP channel server that gives [Claude Code](https://claude.com/claude-code) visual context from your browser: the element you picked, a cropped screenshot and your request.

[![CI](https://github.com/MichaelMakelko/point-and-prompt/actions/workflows/ci.yml/badge.svg)](https://github.com/MichaelMakelko/point-and-prompt/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node.js 20+](https://img.shields.io/badge/node-20%2B-339933?logo=node.js&logoColor=white)
![Chrome MV3](https://img.shields.io/badge/chrome-manifest%20v3-4285F4?logo=googlechrome&logoColor=white)

[Quick start](#quick-start) · [Usage](#usage) · [Security](#security-and-privacy) · [Troubleshooting](#troubleshooting) · [Deutsch](#kurzanleitung-deutsch)

</div>

## Why

Describing UI in words is slow: "the second card in the pricing section, the button under the list". With point-and-prompt you point at it instead.

- **Element mode:** hover highlights an element, a click selects it.
- **Box mode:** drag a rectangle over any area, for example several elements or a gap in the layout.
- **Prompt in place:** a small popover opens next to the selection. Type or dictate your request and press `Enter`.
- **Full context for Claude:** your request, the page URL, a CSS selector, the visible text, trimmed HTML and a screenshot cropped to the selection.
- **No copy and paste:** the request lands in the Claude Code session that is already running in your terminal, and Claude starts right away.
- **Several projects at once:** each Claude Code session is listed by project folder, and every page remembers which session it sends to.
- **Local only:** the extension talks to `127.0.0.1`. Nothing is sent to a third-party server (dictation is the one exception, see [Security and privacy](#security-and-privacy)).

## How it works

```
┌──────────────────────────┐   HTTP 127.0.0.1:7428-7447   ┌──────────────────────┐   stdio   ┌─────────────┐
│ Chrome extension         │ ───────────────────────────▶ │ MCP channel server   │ ────────▶ │ Claude Code │
│ overlay, screenshot      │                              │ validates, forwards  │           │ session     │
└──────────────────────────┘                              └──────────────────────┘           └─────────────┘
```

point-and-prompt is built on [Claude Code channels](https://code.claude.com/docs/en/channels-reference) (research preview). A channel is an MCP server that can push events into a running session. The server here is small: it checks where a request comes from, validates it and hands it to Claude as a message.

Every session takes the first free port from 7428 to 7447. The extension scans that range to find your sessions.

## Requirements

- **Claude Code** with channels support, signed in with claude.ai or a Console API key (not Bedrock, Vertex or Foundry). Team and Enterprise organizations must enable channels in the admin settings.
- **Node.js 20** or newer (22.6 or newer to run the tests).
- **Chrome** or another Chromium browser, version 116 or newer.

## Quick start

**1. Build the server**

```bash
git clone https://github.com/MichaelMakelko/point-and-prompt.git
cd point-and-prompt/server
npm install
npm run build
```

**2. Register it in Claude Code** (once, for all projects)

```bash
claude mcp add --scope user point-and-prompt -- node /absolute/path/to/point-and-prompt/server/dist/index.js
```

**3. Load the extension**

Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked** and pick the `extension/` folder.

**4. Add a shortcut for the channel flag** (optional)

During the research preview, Claude Code needs a flag on every start to accept channel events. There is no setting for it yet. A shell shortcut saves typing:

```powershell
# PowerShell: add to $PROFILE
function claudep { claude --dangerously-load-development-channels server:point-and-prompt @args }
```

```bash
# bash/zsh: add to ~/.bashrc or ~/.zshrc
alias claudep='claude --dangerously-load-development-channels server:point-and-prompt'
```

## Usage

1. Start Claude Code in your project folder with the channel enabled and confirm the startup dialog:

   ```bash
   claudep   # or: claude --dangerously-load-development-channels server:point-and-prompt
   ```

2. Start your dev server and open the page on `http://localhost:<port>` or `http://127.0.0.1:<port>`.
3. Press `Alt+Shift+P` or click the extension icon. The toolbox at the bottom right shows a green dot and the project name when a session is connected.
4. Click an element, or press `B` and drag a box.
5. Type or dictate your request and press `Enter`. The toolbox confirms which project received it, and Claude answers in the terminal.

With several sessions open, click the project name in the toolbox to pick one. The choice is remembered per page origin, for example `localhost:3000`.

### Keyboard shortcuts

| Key | Action |
|---|---|
| `Alt+Shift+P` | Turn the overlay on or off |
| `E` | Element mode |
| `B` | Box mode |
| `Enter` | Send the request |
| `Shift+Enter` | New line in the request |
| `Esc` | Close the popover, or turn the overlay off |

You can change `Alt+Shift+P` on `chrome://extensions/shortcuts`.

## Security and privacy

A tool that forwards text from a browser to a coding agent must be careful about who can send. This is what point-and-prompt does:

- **Loopback only.** The server listens on `127.0.0.1`, never on your network.
- **Extension origin only.** Requests are accepted only with the origin `chrome-extension://moeaooemoikililkakdldlamlgcebpll` (fixed by the public `key` in `manifest.json`). Browsers set this header themselves, so a website cannot forge it and cannot push prompts into your session.
- **No port without opt-in.** The server opens a port only when the session was started with the channel flag.
- **The page cannot press send.** The overlay lives in a closed shadow root and reacts only to real user input, so scripts on the page cannot fill in and submit a request.
- **Page content is data.** Text and HTML from the page are fenced with a random ID per message, and Claude is told to read that block as data and not to follow instructions in it. A page cannot guess the ID, so it cannot end the block early and pose as your request.
- **Validated input.** The server limits sizes, checks types and accepts only PNG screenshots.

What you should know:

- No prompt-injection defense is complete. Use the overlay only on pages you trust.
- Screenshots are saved to your OS temp folder (`<tmp>/point-and-prompt/`) and are not deleted automatically.
- Dictation uses Chrome's Web Speech API, which sends audio to Google for recognition. Don't use the mic button if that is a problem.

Found a security problem? Please report it privately, see [SECURITY.md](SECURITY.md).

## Configuration

Set these environment variables for the server, for example with `claude mcp add --env`.

| Variable | Default | Purpose |
|---|---|---|
| `PNP_PORT` | `7428` | First port of the 20-port range. If you change it, also change `BASE_PORT` in `extension/background.js`. |
| `PNP_SKIP_FLAG_CHECK` | unset | `1` opens the port without checking for the channel flag. |
| `PNP_EXTENSION_ID` | fixed ID | Accept a different extension ID, for example if you remove `key` from the manifest. |

## Troubleshooting

**The toolbox shows a red dot and "keine Session".**
No session with the channel flag was found. Start Claude Code with `claudep` (or the full flag) and confirm the startup dialog. Every Claude Code session starts the server, but the server only opens a port when it sees the flag on Claude Code's command line. If you start Claude Code through a wrapper script, that check can fail: set `PNP_SKIP_FLAG_CHECK=1`.

**The extension icon shows a "!" badge.**
The overlay runs only on `http://localhost` and `http://127.0.0.1`. If the page was already open when you installed the extension, reload it.

**The request was sent "ohne Screenshot".**
Chrome did not allow the capture, usually because the tab was not the active one. Claude still gets the selector, text and HTML.

**Claude does not react to a request.**
Channel events are dropped silently in sessions started without the flag, and in organizations where channels are disabled. Check the [channels documentation](https://code.claude.com/docs/en/channels-reference).

## Limitations

- Local pages over `http` only. `https://localhost` and custom hostnames are not matched.
- Up to 20 sessions at the same time.
- One-way: the overlay confirms delivery, Claude answers in the terminal.
- Claude finds the code through the visible text and the selector. There is no framework-specific source mapping.
- The overlay texts are in German for now.

## Development

```bash
cd server
npm run typecheck
npm test
npm run build
```

The extension has no build step. See [CONTRIBUTING.md](CONTRIBUTING.md) for the project layout and how to send a pull request.

## Kurzanleitung (Deutsch)

1. `cd server && npm install && npm run build`
2. Einmalig für alle Projekte: `claude mcp add --scope user point-and-prompt -- node <Pfad>/server/dist/index.js`
   Kurzbefehl ins PowerShell-Profil (`notepad $PROFILE`): `function claudep { claude --dangerously-load-development-channels server:point-and-prompt @args }`
3. Chrome: `chrome://extensions` → Entwicklermodus → „Entpackte Erweiterung laden“ → Ordner `extension/`
4. Claude im Projektordner mit `claudep` starten. Mehrere Projekte gleichzeitig gehen; in der Toolbox auf den Projektnamen klicken, um die Session für die Seite zu wählen.
5. Dev-Seite auf localhost öffnen, `Alt+Shift+P`, Element anklicken oder mit `B` einen Kasten ziehen, Wunsch tippen oder diktieren, `Enter` (`Shift+Enter` für neue Zeile).

## License

[MIT](LICENSE) © Michael Makelko

point-and-prompt is an independent project and is not affiliated with Anthropic.
