# claude-usage-ios

An iPhone widget that shows how much of your Claude subscription limits you've used: the
**5-hour session** limit and the **weekly** limit, with the time until each resets.
It is a single [Scriptable](https://scriptable.app) script, so you don't need a Mac,
Xcode or an Apple developer account.

## Widget sizes

| Size | Shows |
|---|---|
| Small (home screen) | Two progress bars (session and weekly) with the time until each resets |
| Medium (home screen) | Two rings with percentages and reset times |
| Lock screen, rectangular | Bars for `5h` and `7d`, plus when the session resets |
| Lock screen, circular | A ring with the session percentage |

The colour changes as usage grows: orange below 70%, yellow from 70%, red from 90%.
If a refresh fails, the widget shows the last numbers it fetched and marks them `⚠︎ offline`.

## Setup

1. **Get a token.** On a computer with [Claude Code](https://claude.com/claude-code)
   installed, run:
   ```
   claude setup-token
   ```
   Log in in the browser. The command prints a long-lived token (`sk-ant-oat01-…`).
2. **Install [Scriptable](https://apps.apple.com/app/scriptable/id1405459188)** from the
   App Store.
3. In Scriptable, create a new script and paste in the contents of
   [`claude-usage.js`](claude-usage.js).
4. **Run the script once** in the app and paste the token when it asks. The token is kept
   in the iOS Keychain.
5. **Add the widget.** Long-press the home screen (or the lock screen), add a *Scriptable*
   widget, edit it and choose this script under *Script*.

Run the script in the app again whenever you want to preview the widget, replace the token
or delete it.

## How it works

Tokens from `claude setup-token` only have the `user:inference` scope, so they can't read
Claude's usage endpoint (`/api/oauth/usage` needs `user:profile`). Instead, each refresh
sends a request to `/v1/messages` for a single output token from Haiku. The widget then
reads the usage from the response headers:

```
anthropic-ratelimit-unified-5h-utilization: 0.01   (fraction of the 5-hour limit used)
anthropic-ratelimit-unified-5h-reset:       1794487200   (unix time)
anthropic-ratelimit-unified-7d-utilization: 0.10
anthropic-ratelimit-unified-7d-reset:       1794888000
```

The widget asks to refresh every 15 minutes (`REFRESH_MINUTES`). iOS decides when it
actually refreshes, usually every 15–30 minutes.

## Caveats

- **Undocumented:** these headers aren't a documented API and may change or disappear
  without notice.
- **Small cost:** each refresh is a real request of about 35 input tokens and 1 output
  token, which counts toward your limits. At normal refresh rates this is negligible.
- **May start the session clock:** if no 5-hour window is running, a refresh probably
  starts one. Your session reset time would then depend on when the widget refreshed,
  not on when you started working.
- **Keep the token secret:** anyone who has it can spend your plan's usage. If it leaks,
  revoke it on claude.ai under *Settings → Claude Code* and generate a new one.

## Development

The data-fetching part can be tested outside iOS with Node.js by replacing Scriptable's
`Request` class with `fetch`:

```js
// harness.mjs — usage: node harness.mjs sk-ant-oat01-...
import fs from "fs";
globalThis.Request = class {
  constructor(u) { this.url = u; this.method = "GET"; }
  async loadString() {
    const r = await fetch(this.url, { method: this.method, headers: this.headers, body: this.body });
    this.response = { statusCode: r.status, headers: Object.fromEntries(r.headers) };
    return await r.text();
  }
};
globalThis.Color = class { static dynamic() { return null; } };
const src = fs.readFileSync("claude-usage.js", "utf8").split("// ---------- formatting")[0];
console.log(await new Function("token", src + "\nreturn fetchUsage(token);")(process.argv[2]));
```

The drawing code only runs inside Scriptable.
