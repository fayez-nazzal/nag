# nag

Persistent reminders that keep coming back until you handle them, and survive a reboot.

A reminder is a JSON file in `~/.nag/reminders`. One launchd agent wakes on an interval, fires whatever is due, and reloads itself at login. A reminder stops only when you acknowledge it.

Built for the case where you have to walk away from something urgent and cannot trust yourself to remember it later.

## Install

```sh
bun install        # deps
bun link           # global `nag` command (symlinks into ~/.bun/bin)
nag install        # load the launchd agent and add the ~/.zshrc banner line
```

Requires [Bun](https://bun.sh). Ensure `~/.bun/bin` is on your `PATH`:

```sh
echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc
```

`nag install` writes `~/Library/LaunchAgents/local.nag.plist` and adds one fenced line to `~/.zshrc`. `nag uninstall` takes both back out.

## Usage

```sh
nag add --id pay-invoice --title "Invoice is due" --message "Pay the studio invoice." --every 2h
nag add --id standup --title "Standup in 10" --message "Post the update." --start-at +50m --channel dialog
nag list                       # every reminder with its state, * marks pending
nag show pay-invoice           # the raw JSON
nag ack pay-invoice            # handled, stops firing
nag remove pay-invoice         # delete it outright
nag fire pay-invoice           # fire once now, ignoring the schedule
```

`dispatch` and `banner` exist for the machine, not for you. launchd runs `nag dispatch`, and `~/.zshrc` runs `nag banner`.

## Channels

A reminder can use any mix of three, and defaults to all of them.

- `dialog` a blocking AppleScript dialog with `Remind me later`, `I have handled it`, and `Open` when a page is attached. This is the part that is hard to ignore.
- `notification` a macOS notification with a sound, fired alongside the dialog.
- `terminal` a red banner printed in every new shell while the reminder is pending.

```sh
nag add --id review --title "Review the PR" --message "It is blocking the release." --channel dialog,terminal
```

## Attaching a page

`--page` takes a file path or a URL. The dialog gains an `Open` button, and the terminal banner prints the path. Use it to carry the detail that does not fit in a dialog.

```sh
nag add --id sprint --title "Sprint input is overdue" \
  --message "Three stories are waiting on you." \
  --page ~/sprint-mentions/2026-08-06/briefing.html
```

## Scheduling

- `--every <duration>` how often it repeats, default `10m`. Forms are `45s`, `10m`, `2h`, `1d`, and a bare number means seconds.
- `--start-at <when>` holds it until then. Takes an ISO time or an offset like `+30m`.

The dispatcher wakes every `60s` by default and fires whatever is due. Change that with `nag install --interval 5m`. The wake interval is the floor on how precise any reminder can be.

## Why the dialog stays put

An AppleScript `display dialog` sent inside a `tell application "System Events"` block inherits the 120 second Apple Event reply timeout. Left alone it dies after two minutes and returns nothing, so the reminder silently disappears. Every dialog here is wrapped in `with timeout of 604800 seconds`, which is the whole reason this tool exists rather than a shell script.

## Layout

```
src/reminder.ts   the type, durations, and whether a reminder is due
src/store.ts      paths, read, write, list under ~/.nag
src/deliver.ts    AppleScript dialog and notification
src/banner.ts     terminal banner text
src/dispatch.ts   the due loop, locks, and what each button does
src/install.ts    launchd plist and the ~/.zshrc line
src/cli.ts        argument parsing
```

Delivery is injected into `dispatch`, so the whole due loop is tested without a dialog ever appearing.

```sh
bun test
```

## Notes

- macOS only. Everything visible goes through `osascript` and `launchctl`.
- A dialog blocks its dispatch run, so a second reminder waits for the first to be answered. A lock file per reminder stops dialogs stacking up across runs.
- `NAG_HOME` overrides `~/.nag`, which is how the tests stay off your real store.
