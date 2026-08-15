---
name: nag
description: Sets a durable macOS reminder that keeps re-firing on an interval until the user runs `nag ack <id>`, surviving a reboot through a `launchd` agent. Use when you need to hand an obligation back to a human and prove it landed, or when the user says "remind me", "nag me", "keep reminding me until I do it", "set a recurring reminder", "do not let me forget", "ping me every hour", "remind me before standup", "remind me after the build finishes", or asks to check, list, snooze, replace, or acknowledge an existing reminder. Also use when another workflow ends with something a human still owes, such as a review to answer or an invoice to pay, and a one shot notification would be lost. Prefer this over a plain notification whenever the reminder must repeat or must outlive the current session.
license: MIT
compatibility: macOS only, needs the `nag` CLI on `PATH`, uses `osascript` and `launchctl`
metadata:
  author: Fayez Nazzal
  version: "0.2.1"
---

# nag

Stores a reminder as JSON and re-fires it on an interval until the user acknowledges it.

## When to use

- The user asks to be reminded, nagged, or pinged about something later.
- A task ends with an obligation only a human can clear.
- A reminder must repeat, or must survive closing the session or rebooting.
- The user asks what reminders are pending, or wants one replaced or removed.

## Check first

- `command -v nag` returns a path. If not, stop and tell the user to install it.
- The platform is macOS. Nothing works elsewhere.
- When you are only trying a command out, set a scratch ledger first with `export NAG_HOME="$(mktemp -d)"`.
- If the user reports that nothing ever fires, the `launchd` agent is missing. Ask them to run `nag install`. Never run it yourself.

## Core recipe

```sh
nag add \
  --id pay-invoice \
  --title "Invoice is due" \
  --message "Pay the studio invoice." \
  --every 2h \
  --json
nag show pay-invoice --json
```

Assert `ok` is `true`, `code` is `0`, and `data.acknowledgedAt` is `null`.

Useful extras.

- `--start-at +50m` holds the reminder until later.
- `--channel terminal` avoids any dialog.
- `--replace` overwrites an existing id, and resets `lastFiredAt` to `null`.

## Reading the result

With `--json` every command prints exactly one envelope on stdout, success or failure.

- `ok` is `true` only when `code` is `0`. Assert on this first.
- `reason` carries the error text on failure and is `null` on success.
- `data` is the reminder record for `add`, `show`, `ack` and `fire`, and `{ reminders, unreadable }` for `list`.
- `command` is the literal string `unknown` on any failure. Never branch on it.

Exit codes worth branching on.

- `0` worked.
- `1` no reminder with that id.
- `2` bad input, such as a bad id, a bad duration, or a missing `--id`, `--title` or `--message`.
- `3` the id already exists and is unacknowledged. Retry with `--replace` or pick a new id.
- `4` the dialog failed to show.
- `6` internal error.

## Rules

- Never run `nag dispatch` or `nag fire`. A due `dialog` reminder blocks for up to an hour. Leave firing to `launchd`.
- Always pass `--json` and branch on the exit code. Never parse the human text.
- Always pass an explicit `--id`, lower case, matching `^[a-z0-9][a-z0-9._-]*$`.
- Durations use `s`, `m`, `h`, `d` or a bare number. `2h` works, `90x` and `0` exit `2`.
- Read state with `nag show <id> --json`, never by opening files under `~/.nag/reminders`.
- Never run `nag install` or `nag uninstall` without asking the user first.
- Report only the id and title, the interval or wait time, `nag ack <id>` as the stop command, and the record path. Never paste a raw envelope.

Full recipes and pitfalls live in `AGENTS.md` at the repo root.
