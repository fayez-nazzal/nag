# nag

Reminders on macOS that keep coming back until you deal with them, and survive a reboot.

A reminder is one JSON file under `~/.nag/reminders`. A single `launchd` agent wakes on a fixed interval, fires whatever is due, and starts again at login. A reminder stops only when you acknowledge it.

It is built for the moment you have to walk away from something urgent and cannot trust yourself to remember it later.

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

`bun link` creates the global `nag` command. `nag install` loads the `launchd` agent and adds one fenced line to `~/.zshrc`. `nag uninstall` removes both.

If `nag` is not found, add the Bun bin directory to your `PATH`:

```sh
echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc
```

## Configure

- `nag install --interval 5m` sets how often the dispatcher wakes. The default is `60s`. This interval is the floor on how precise any reminder can be.
- `NAG_HOME` overrides the store location, which defaults to `~/.nag`. The tests use it to stay away from your real reminders.

There is no config file. Every setting is a flag or an environment variable.

## Daily use

```sh
nag add --id pay-invoice --title "Invoice is due" --message "Pay the invoice." --every 2h
nag list                  # every reminder and its state, * marks pending
nag show pay-invoice      # the raw JSON
nag ack pay-invoice       # handled, stops firing
nag remove pay-invoice    # delete it
nag fire pay-invoice      # fire once now, ignoring the schedule
```

`nag dispatch` and `nag banner` are for the machine. `launchd` runs `dispatch`, and `~/.zshrc` runs `banner`.

## Channels

A reminder can use any mix of three channels, and uses all three by default.

- `dialog` is a blocking AppleScript dialog with `Remind me later`, `I have handled it`, and `Open` when a page is attached. This is the part that is hard to ignore.
- `notification` is a macOS notification with a sound, fired alongside the dialog.
- `terminal` is a red banner printed in every new shell while the reminder is pending.

```sh
nag add --id review --title "Review the pull request" --message "It is blocking the release." --channel dialog,terminal
```

## Attaching a page

`--page` takes a file path or a URL. The dialog gains an `Open` button, and the terminal banner prints the target. Use it to carry detail that does not fit in a dialog.

```sh
nag add --id report --title "Report is overdue" \
  --message "Three items are waiting on you." \
  --page ~/reports/summary.html
```

## Scheduling

- `--every <duration>` sets the repeat interval. The default is `10m`. Accepted forms are `45s`, `10m`, `2h`, `1d`, and a bare number meaning seconds.
- `--start-at <when>` holds a reminder until then. Accepts an ISO time or an offset such as `+30m`.

## Why the dialog stays put

An AppleScript `display dialog` inside a `tell application "System Events"` block inherits the 120 second Apple Event reply timeout. Left alone it dies after two minutes and returns nothing, so the reminder disappears in silence. Every dialog here is wrapped in `with timeout of 604800 seconds`. That single detail is the reason this tool exists rather than a short shell script.

## Layout

```
src/reminder.ts   the type, durations, and whether a reminder is due
src/store.ts      paths, read, write, and list under ~/.nag
src/deliver.ts    AppleScript dialog and notification
src/banner.ts     terminal banner text
src/dispatch.ts   the due loop, locks, and what each button does
src/install.ts    the launchd plist and the ~/.zshrc line
src/cli.ts        argument parsing
```

Delivery is injected into `dispatch`, so the whole due loop is tested without a dialog ever appearing.

## Tests

```sh
bun test
```

## Notes

- A dialog blocks its dispatch run, so a second reminder waits for the first to be answered. One lock file per reminder stops dialogs stacking up across runs.

## License

MIT. See `LICENSE`.
