# AGENTS.md

`nag` is a macOS reminder that keeps coming back until a human acknowledges it. An agent uses it to hand a durable obligation back to its user and then prove the obligation landed. The obvious alternative is a one shot notification, which is fired and forgotten and vanishes if nobody is looking. `nag` stores each reminder as a JSON file, re-fires it on an interval through a `launchd` agent that survives a reboot, and stops only on `nag ack <id>`. Every command speaks a full JSON envelope on `--json` with a closed seven value exit code table, so an agent never has to read prose. `README.md` documents what each flag is. This file documents the order to run things in.

## Golden rules

- Never run `nag dispatch` or `nag fire` in a foreground step. A due reminder on the `dialog` channel opens a blocking macOS dialog with a `3600` second timeout, from `DIALOG_TIMEOUT_SECONDS` in `src/alert/screen.ts`. Your run will hang for an hour.
- Leave firing to `launchd`. Creating the reminder with `nag add` is the whole job.
- Always pass `--json` and branch on the exit code. Never parse the human text.
- Always set `NAG_HOME` to a scratch directory when you are trying something out. That keeps the real ledger at `~/.nag` untouched.
- Always pass an explicit `--id`. The id is the handle for `show`, `ack` and `remove`, and a repeat run without `--replace` fails with code `3`.
- Never run `nag install` or `nag uninstall` without asking the user first. They write `~/Library/LaunchAgents/io.fayez.nag.plist` and a fenced block in `~/.zshrc`.
- Read state with `nag show <id> --json`, not by opening the file under `~/.nag/reminders`.
- Keep context small. Use `nag list --json` for a sweep and `nag show <id> --json` for one record. Do not paste the whole ledger into a report.
- macOS only. Everything visible goes through `osascript` and `launchctl`.

## Recipes

### 1. Set a durable reminder and prove it landed

Proves the reminder exists, is pending, and carries the interval you asked for.

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

### 2. Try the tool safely with a scratch ledger

Proves the command shape works without touching the real reminders.

```sh
export NAG_HOME="$(mktemp -d)"
nag add --id demo --title "Demo" --message "Body." --every 2h --channel terminal --json
nag list --json
nag remove demo --json
```

Real captured output of the first command:

```json
{"tool":"nag","version":"0.1.1","command":"add","ok":true,"code":0,"status":"success","reason":null,"message":"added demo, repeats every 2h on terminal","data":{"id":"demo","title":"Demo","message":"Body.","page":null,"channels":["terminal"],"everySeconds":7200,"startAt":null,"lastFiredAt":null,"lastDeliveredAt":null,"lastDeliveryError":null,"acknowledgedAt":null,"createdAt":"2026-08-15T06:25:27.983Z"}}
```

### 3. Hold a reminder until later and keep it quiet

Proves a reminder can wait, and that `--channel terminal` avoids any dialog.

```sh
nag add \
  --id standup \
  --title "Standup in 10" \
  --message "Post the update." \
  --start-at +50m \
  --channel terminal \
  --json
nag list
```

Real captured `nag list` output:

```
* demo  every 2h  Invoice is due
* later  waits until 2026-08-15T06:55:43.444Z  T
```

### 4. Replace a reminder you already set

Proves the conflict guard and the fix for it.

```sh
nag add --id demo --title "Demo" --message "Updated body." --every 1h --replace --channel terminal --json
```

Without `--replace` the same call fails. Real captured output:

```json
{"tool":"nag","version":"0.1.1","command":"unknown","ok":false,"code":3,"status":"failure","reason":"A reminder with id \"demo\" already exists and is not acknowledged. Use --replace to overwrite it.","message":"A reminder with id \"demo\" already exists and is not acknowledged. Use --replace to overwrite it.","data":null}
```

## Reading the output

With `--json` every command prints exactly one envelope on stdout, success or failure. Fields come from `buildEnvelope` in `src/result/envelope.ts`.

- `tool` is always the string `nag`.
- `version` is the CLI version string.
- `command` is the command name on success. On any thrown error it is the literal string `unknown`, so do not use it to tell commands apart.
- `ok` is `true` only when `code` is `0`. Assert on this first.
- `code` matches the process exit code.
- `status` is `success` or `failure`.
- `reason` is `null` on success and carries the error text on failure.
- `message` is the human text. Ignore it in logic.
- `data` is the payload. For `add`, `show`, `ack` and `fire` it is the reminder record. For `list` it is `{ reminders, unreadable }`. For `banner` it is `{ reminders }`. For `dispatch` it is `{ fired }`. For `remove` it is `{ id }`. For `install` and `uninstall` it is `{ notes }`.

Reminder record fields worth asserting on, from `src/obligation/reminder.ts`.

- `acknowledgedAt` is `null` while the reminder is still pending.
- `startAt` is `null` unless you passed `--start-at`.
- `everySeconds` is the interval in seconds.
- `lastFiredAt` is `null` until the dispatcher picks it up.
- `lastDeliveryError` is `null` when the last dialog was delivered cleanly.

Exit codes, the full table from `EXIT_CODE` in `src/result/envelope.ts`.

| Code | Name | When you see it |
| --- | --- | --- |
| `0` | `ok` | The command worked. |
| `1` | `notFound` | No reminder with that id, on `show`, `ack`, `remove` or `fire`. |
| `2` | `invalidInput` | Bad id, bad duration, unknown channel, unknown command, missing `--id`, `--title` or `--message`. |
| `3` | `conflict` | `add` hit an existing unacknowledged id and you did not pass `--replace`. |
| `4` | `deliveryFailed` | `osascript` failed while showing a dialog during `fire` or `dispatch`. |
| `5` | `notFit` | Reserved. No command path returns it today. |
| `6` | `internalError` | Any error that is not a `NagError`. |

Real captured failure and its exit code:

```
$ nag show nope --json
{"tool":"nag","version":"0.1.1","command":"unknown","ok":false,"code":1,"status":"failure","reason":"No reminder with id \"nope\".","message":"No reminder with id \"nope\".","data":null}
EXIT=1
```

## Pitfalls

| Symptom | Cause | Fix |
| --- | --- | --- |
| The command hangs for up to an hour. | A due `dialog` reminder opened a blocking AppleScript dialog with a `3600` second timeout, in `src/alert/screen.ts`. | Never call `dispatch` or `fire` yourself. Let `launchd` do it. Use `--channel terminal` while testing. |
| `add` exits `3`. | The id already exists and is not acknowledged, guarded in `commandAdd` in `src/cli.ts`. | Pass `--replace`, or pick a new id. |
| `--replace` lost the firing history. | `add` writes a fresh record with `lastFiredAt` set to `null`. | Read the old record with `nag show <id> --json` before replacing it. |
| The envelope says `"command":"unknown"` on a failure. | The error path builds the envelope with a fixed `unknown` command name in `src/cli.ts`. | Branch on `code` and `reason`, never on `command`. |
| `add` exits `2` on an id that looks fine. | The id rule is `^[a-z0-9][a-z0-9._-]*$` in `src/obligation/reminder.ts`. Upper case and spaces are rejected. | Lower case the id and use dot, dash or underscore instead of spaces. |
| `--every 0` or `--every 90x` exits `2`. | `parseDuration` accepts only `s`, `m`, `h`, `d` or a bare number, and rejects anything that resolves to zero. | Use forms like `45s`, `10m`, `2h`, `1d`. |
| The banner lists a reminder that is not due yet. | `renderBanner` in `src/banner/banner.ts` filters on pending plus the `terminal` channel only. It ignores `startAt`. | Use `nag list` or the `startAt` field to judge whether a reminder is actually due. |
| A test run polluted the real reminders. | The store defaults to `~/.nag` in `rootDir` in `src/ledger/records.ts`. | Set `NAG_HOME` to a scratch directory first. |
| Nothing ever fires. | The `launchd` agent is not installed, so nothing calls `dispatch`. | Ask the user to run `nag install`. Do not run it for them. |

## Reporting

Tell your user four things and nothing else.

- What you set, by `id` and `title`.
- How often it repeats, and whether it waits for a `startAt` time.
- The one command that stops it, `nag ack <id>`.
- Where the record lives, `~/.nag/reminders/<id>.json`.

Report a failure as the exit code plus the `reason` string from the envelope. Never paste a raw envelope, a full `nag list --json` dump, or the contents of the ledger into your reply.
