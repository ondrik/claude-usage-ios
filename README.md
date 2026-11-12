# claude-usage-ios

An iPhone widget that shows how much of your Claude subscription limits you've used: the
**5-hour session** limit and the **weekly** limit, with the time until each resets.
It works with **several Claude accounts** at once.
It is a single [Scriptable](https://scriptable.app) script, so you don't need a Mac,
Xcode or an Apple developer account.

## Widget sizes

A widget shows either **all accounts** or **one account**, depending on its *Parameter*
field (see [Choosing accounts](#choosing-accounts)).

| Size | All accounts | One account |
|---|---|---|
| Small | One line per account with the session and weekly percentages (up to 5 accounts) | Two progress bars with the time until each resets |
| Medium | A row per account with bars, percentages and reset times (up to 3 accounts) | Two rings with percentages and reset times |
| Large | Like medium, up to 7 accounts | Same as medium |
| Lock screen, rectangular | `name  session% · weekly%`, up to 3 accounts | Bars for `5h` and `7d`, plus when the session resets |
| Lock screen, circular | Session ring of the first account | Session ring of that account |

The colour changes as usage grows: orange below 70%, yellow from 70%, red from 90%.
If a refresh fails, the widget shows the last numbers it fetched and marks them `⚠︎ offline`.
An account with an invalid token is marked `⚠︎ error`.

## Setup

1. **Get a token for each account.** On a computer with
   [Claude Code](https://claude.com/claude-code) installed, run:
   ```
   claude setup-token
   ```
   Log in in the browser with the account you want. The command prints a long-lived token
   (`sk-ant-oat01-…`). Repeat for every account, logging in with a different one each time.
2. **Install [Scriptable](https://apps.apple.com/app/scriptable/id1405459188)** from the
   App Store.
3. In Scriptable, create a new script and paste in the contents of
   [`claude-usage.js`](claude-usage.js).
4. **Run the script** in the app, choose **Add account**, and enter a name (for example
   *Work*) and the token. The token is tested before it's saved, and kept in the iOS
   Keychain. Repeat for each account.
5. **Add the widget.** Long-press the home screen (or the lock screen), add a *Scriptable*
   widget, edit it and choose this script under *Script*.

Run the script in the app again whenever you want to preview the widget, or to add, rename,
reorder, delete an account or replace its token (**Manage accounts**). Accounts appear in
the widget in the order shown there.

Upgrading from the single-account version: your existing token is moved over automatically
as an account named *Claude*. You can rename it under **Manage accounts**.

### Installing without copy and paste

Scriptable keeps scripts as plain files in **iCloud Drive › Scriptable**. On any computer,
open [icloud.com/iclouddrive](https://www.icloud.com/iclouddrive) in a browser and drag
`claude-usage.js` into that folder. It appears in Scriptable a few seconds later.
Alternatively, on the iPhone, open the
[raw file](https://raw.githubusercontent.com/ondrik/claude-usage-ios/master/claude-usage.js)
in Safari and choose Share → Save to Files → iCloud Drive › Scriptable.

### Updating

Run the script in the app and choose **Update from GitHub**. It downloads the latest
`claude-usage.js` from this repository's `master` branch, asks before replacing itself, and
keeps your accounts. Run the script again afterwards to use the new version. Widgets pick
it up on their next refresh.

The update replaces the script with whatever is on `master`. That code can read the
tokens stored in the Keychain, so only use the update button with a repository you trust.

## Choosing accounts

- With an empty **Parameter**, the widget shows all accounts.
- To show one account, edit the widget and type that account's name into the
  **Parameter** field. The match ignores upper and lower case. For example, you can have
  one medium widget for *Work* and another for *Personal*.

Each refresh sends one request per account shown, so a single-account widget only uses
that account's quota.

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
const src = fs.readFileSync("claude-usage.js", "utf8").split("// Fetch all accounts")[0];
console.log(await new Function("token", src + "\nreturn fetchUsage(token);")(process.argv[2]));
```

The drawing code only runs inside Scriptable.
