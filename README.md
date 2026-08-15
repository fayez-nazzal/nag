# nag

Reminders on macOS that keep coming back until you deal with them, and survive a reboot.

A reminder is one JSON file under `~/.nag/reminders`. A single `launchd` agent wakes on a fixed interval, fires whatever is due, and starts again at login. A reminder stops only when you acknowledge it.

`nag` is built to be called by an AI coding agent, not only by a person at a prompt. Every command prints one JSON envelope with `--json` and returns one of seven documented exit codes, so an agent can set a reminder and verify it landed without reading prose. Agents should read [`AGENTS.md`](AGENTS.md) for the recipes, the golden rules and the traps.

## Requirements

- macOS. Everything visible goes through `osascript` and `launchctl`.
- [Bun](https://bun.sh).
- `~/.bun/bin` on your `PATH`.

## Install

```sh
bun install
bun link
nag install
```

- `bun link` creates the global `nag` command.
- `nag install` loads the `launchd` agent and adds one fenced line to `~/.zshrc`.
- `nag uninstall` removes both.

There is no build step. The `bin` entry points at `src/cli.ts` and Bun runs it directly.

If `nag` is not found, add the Bun bin directory to your `PATH`:

```sh
echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc
```

## The smallest useful command

```sh
nag add --id pay-invoice --title "Invoice is due" --message "Pay the invoice." --every 2h
```

That is a reminder that fires every two hours until you run `nag ack pay-invoice`.

## Commands

- `nag add` creates a reminder, or replaces one with `--replace`.
- `nag list` lists every reminder with its state. A `*` marks a pending one.
- `nag show <id>` prints one reminder as JSON.
- `nag ack <id>` marks it handled so it stops firing.
- `nag remove <id>` deletes it.
- `nag fire <id>` fires one reminder now and ignores the schedule.
- `nag dispatch` fires everything due. This is what `launchd` runs.
- `nag banner` prints pending reminders. This is what `~/.zshrc` runs.
- `nag install` loads the agent and adds the `~/.zshrc` line.
- `nag uninstall` unloads the agent and takes the line back out.

## Flags

Add options.

- `--id <id>` is the stable id. Lower case letters, digits, dot, dash and underscore.
- `--title <text>` is the dialog title.
- `--message <text>` is the body shown in the dialog.
- `--page <path|url>` is named in the banner and carried in the dialog body.
- `--every <duration>` is the repeat interval. The default is `10m`.
- `--start-at <when>` holds the reminder until then. Accepts an ISO time or an offset such as `+30m`.
- `--channel <list>` is a comma list from `dialog` and `terminal`. The default is both.
- `--replace` overwrites an existing unacknowledged reminder with the same id.

Install options.

- `--interval <duration>` sets how often `launchd` wakes the dispatcher. The default is `60s`.

Global options.

- `-h`, `--help` shows the help text.
- `-v`, `--version` shows the version.
- `--json` prints the machine readable result on stdout.

Durations accept `45s`, `10m`, `2h`, `1d`, and a bare number meaning seconds.

`--json` is read by the argument parser, so a value after `--` is never mistaken for the flag.

## Environment

- `NAG_HOME` overrides the store location. It defaults to `~/.nag`. The tests use it to stay away from your real reminders.

There is no config file. Every setting is a flag or an environment variable.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | ok |
| `1` | not found |
| `2` | invalid input |
| `3` | conflict |
| `4` | delivery failed |
| `5` | not fit |
| `6` | internal error |

## JSON shape

Every command with `--json` prints one envelope.

```json
{
  "tool": "nag",
  "version": "0.1.0",
  "command": "add",
  "ok": true,
  "code": 0,
  "status": "success",
  "reason": null,
  "message": "added demo, repeats every 2h on dialog, terminal",
  "data": {}
}
```

- `status` is `success` or `failure`.
- `reason` is `null` on success and carries the error text on failure.
- `data` holds the command payload. For `add`, `show`, `ack` and `fire` it is the reminder record.

A failure with `--json` still prints an envelope on stdout, with the matching exit code.

## Channels

A reminder can use either of two channels, and uses both by default.

- `dialog` is a loud AppleScript alert with a single button. It is hard to ignore. It does not write state, so clearing a reminder is always `nag ack <id>`.
- `terminal` is a red banner printed in every new shell while the reminder is pending. It needs no permission and works over `ssh`.

```sh
nag add --id review --title "Review the pull request" --message "It is blocking the release." --channel dialog,terminal
```

## Attaching a page

`--page` takes a file path or a URL. The dialog gains an `Open` button, and the terminal banner prints the target.

```sh
nag add --id report --title "Report is overdue" \
  --message "Three items are waiting on you." \
  --page ~/reports/summary.html
```

## Why the dialog stays put

An AppleScript `display dialog` inside a `tell application "System Events"` block inherits the 120 second Apple Event reply timeout. Left alone it dies after two minutes and returns nothing, so the reminder disappears in silence. Every dialog here is wrapped in `with timeout of 3600 seconds`. That single detail is the reason this tool exists rather than a short shell script.

## Layout

```
src/cli.ts                  argument parsing, command routing, help text, and the only process exit
src/obligation/reminder.ts  the reminder record, the id rule, the schedule, the pure state transitions
src/ledger/records.ts       paths, atomic writes, tolerant reads under ~/.nag
src/alert/screen.ts         the AppleScript text, the Screen port, and the delivery outcome
src/dispatch/run.ts         the pure due-sweep plan and the executor that runs it
src/banner/banner.ts        terminal banner text
src/installation/apply.ts   the launchd plist and the ~/.zshrc line
src/result/envelope.ts      the exit-code table, the JSON envelope, the human prose
```

Delivery is injected into `dispatch` through the `Screen` port, so the whole due loop is tested without a dialog ever appearing. Every decision is a pure function taking `now` as a parameter, so the suite needs no clock, no disk and no `osascript`.

**Navigation rule.** Start from the command name. `src/cli.ts` maps every command to exactly one exported function in exactly one domain folder, so one file read tells you where a feature lives. Inside a folder the pure rules sit in files named after the concept, and the single file that touches the world is named after the boundary it crosses.

## Notes

- A dialog blocks its dispatch run, so a second reminder waits for the first to be answered.

## Tests

```sh
bun test
```

## License

MIT. See `LICENSE`.
