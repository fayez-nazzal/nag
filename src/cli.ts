#!/usr/bin/env bun

import { parseArgs } from "node:util";
import { renderBanner } from "@nag/banner/banner.ts";
import { dispatch, fireReminder } from "@nag/dispatch/run.ts";
import { DEFAULT_DISPATCH_INTERVAL_SECONDS, runInstall, runUninstall } from "@nag/installation/apply.ts";
import {
  ALL_CHANNELS,
  DEFAULT_EVERY_SECONDS,
  describeState,
  formatDuration,
  isAcknowledged,
  parseChannels,
  parseDuration,
  parseStartAt,
  validateId,
  type Reminder,
} from "@nag/obligation/reminder.ts";
import { buildEnvelope, EXIT_CODE, NagError, type Envelope, type ExitCode } from "@nag/result/envelope.ts";
import { listReminders, loadReminder, removeReminder, saveReminder } from "@nag/ledger/records.ts";

export const VERSION = "0.1.0";

export const COMMAND_NAMES = [
  "add",
  "list",
  "show",
  "ack",
  "remove",
  "banner",
  "dispatch",
  "fire",
  "install",
  "uninstall",
] as const;

const HELP = `nag ${VERSION} — persistent reminders that keep coming back until you handle them

USAGE
  nag <command> [options]

  A reminder lives in ~/.nag/reminders as one JSON file. A single launchd
  agent wakes on an interval, fires whatever is due, and survives a reboot.
  A reminder stops only when you acknowledge it.

COMMANDS
  add                 Create a reminder, or replace one with --replace
  list                List every reminder with its state
  show <id>           Print one reminder as JSON
  ack <id>            Mark it handled, it stops firing
  remove <id>         Delete it outright
  fire <id>           Fire one reminder now, ignoring the schedule
  dispatch            Fire everything due, this is what launchd runs
  banner              Print pending reminders, this is what ~/.zshrc runs
  install             Load the launchd agent and add the ~/.zshrc line
  uninstall           Unload the agent and take the ~/.zshrc line back out

ADD OPTIONS
      --id <id>          Stable id, lower case letters digits dot dash underscore
      --title <text>     Dialog title
      --message <text>   Body shown in the dialog
      --page <path|url>  Named in the banner and carried in the dialog body
      --every <duration> Repeat interval, forms like 45s 10m 2h 1d (default ${formatDuration(DEFAULT_EVERY_SECONDS)})
      --start-at <when>  ISO time, or an offset like +30m, to hold it until then
      --channel <list>   Comma list from ${ALL_CHANNELS.join(", ")} (default all)
      --replace          Overwrite an existing unacknowledged reminder with this id

INSTALL OPTIONS
      --interval <duration>  How often launchd wakes the dispatcher (default ${formatDuration(DEFAULT_DISPATCH_INTERVAL_SECONDS)})

GLOBAL
  -h, --help            Show this help
  -v, --version         Show version
      --json            Print the machine readable result on stdout

EXIT CODES
  0 ok  1 not-found  2 invalid-input  3 conflict  4 delivery-failed  5 not-fit  6 internal-error

EXAMPLES
  nag add --id pay-invoice --title "Invoice is due" --message "Pay the studio invoice." --every 2h
  nag add --id standup --title "Standup in 10" --message "Post the update." --start-at +50m --channel dialog
  nag list
  nag ack pay-invoice
`;

function parse(argv: string[]) {
  return parseArgs({
    args: argv,
    options: {
      id: { type: "string" },
      title: { type: "string" },
      message: { type: "string" },
      page: { type: "string" },
      every: { type: "string" },
      "start-at": { type: "string" },
      channel: { type: "string" },
      interval: { type: "string" },
      replace: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
    },
    allowPositionals: true,
  });
}

function requireValue(value: string | undefined, name: string): string {
  if (value === undefined || value.length === 0) {
    throw new NagError(EXIT_CODE.invalidInput, `Missing --${name}.`);
  }
  return value;
}

function requireReminder(id: string): Reminder {
  const reminder = loadReminder(id);
  if (reminder === null) {
    throw new NagError(EXIT_CODE.notFound, `No reminder with id "${id}".`);
  }
  return reminder;
}

function commandAdd(values: Record<string, unknown>, now: Date): Envelope {
  const id = validateId(requireValue(values.id as string | undefined, "id"));
  const existing = loadReminder(id);
  if (existing !== null && !isAcknowledged(existing) && values.replace !== true) {
    throw new NagError(
      EXIT_CODE.conflict,
      `A reminder with id "${id}" already exists and is not acknowledged. Use --replace to overwrite it.`,
    );
  }
  let everySeconds = DEFAULT_EVERY_SECONDS;
  if (typeof values.every === "string") {
    everySeconds = parseDuration(values.every);
  }
  let channels = ALL_CHANNELS;
  if (typeof values.channel === "string") {
    channels = parseChannels(values.channel);
  }
  let startAt: string | null = null;
  if (typeof values["start-at"] === "string") {
    startAt = parseStartAt(values["start-at"], now);
  }
  let page: string | null = null;
  if (typeof values.page === "string" && values.page.length > 0) {
    page = values.page;
  }
  const reminder: Reminder = {
    id,
    title: requireValue(values.title as string | undefined, "title"),
    message: requireValue(values.message as string | undefined, "message"),
    page,
    channels,
    everySeconds,
    startAt,
    lastFiredAt: null,
    lastDeliveredAt: null,
    lastDeliveryError: null,
    acknowledgedAt: null,
    createdAt: now.toISOString(),
  };
  saveReminder(reminder);
  const message = `added ${id}, repeats every ${formatDuration(everySeconds)} on ${channels.join(", ")}`;
  return buildEnvelope(VERSION, "add", EXIT_CODE.ok, message, reminder);
}

function commandList(now: Date): Envelope {
  const { reminders, unreadable } = listReminders();
  let output = "no reminders";
  if (reminders.length > 0) {
    output = reminders
      .map((reminder) => {
        let marker = "*";
        if (isAcknowledged(reminder)) {
          marker = " ";
        }
        return `${marker} ${reminder.id}  ${describeState(reminder, now)}  ${reminder.title}`;
      })
      .join("\n");
  }
  if (unreadable.length > 0) {
    output = `${output}\nunreadable: ${unreadable.join(", ")}`;
  }
  return buildEnvelope(VERSION, "list", EXIT_CODE.ok, output, { reminders, unreadable });
}

function commandShow(id: string): Envelope {
  const reminder = requireReminder(id);
  return buildEnvelope(VERSION, "show", EXIT_CODE.ok, JSON.stringify(reminder, null, 2), reminder);
}

function commandBanner(): Envelope {
  const reminders = listReminders().reminders;
  return buildEnvelope(VERSION, "banner", EXIT_CODE.ok, renderBanner(reminders), { reminders });
}

function commandDispatch(now: Date): Envelope {
  const result = dispatch(now);
  const failed = result.fired.filter((id) => loadReminder(id)?.lastDeliveryError !== null);
  let code: Envelope["code"] = EXIT_CODE.ok;
  if (failed.length > 0) {
    code = EXIT_CODE.deliveryFailed;
  }
  return buildEnvelope(VERSION, "dispatch", code, `fired ${result.fired.length}`, result);
}

function commandFire(id: string, now: Date): Envelope {
  const reminder = requireReminder(id);
  fireReminder(reminder, now);
  const stored = requireReminder(id);
  let code: Envelope["code"] = EXIT_CODE.ok;
  if (stored.lastDeliveryError !== null) {
    code = EXIT_CODE.deliveryFailed;
  }
  return buildEnvelope(VERSION, "fire", code, `fired ${id}`, stored);
}

function commandAck(id: string, now: Date): Envelope {
  const reminder = requireReminder(id);
  reminder.acknowledgedAt = now.toISOString();
  saveReminder(reminder);
  return buildEnvelope(VERSION, "ack", EXIT_CODE.ok, `acknowledged ${id}`, reminder);
}

function commandRemove(id: string): Envelope {
  const removed = removeReminder(id);
  if (!removed) {
    throw new NagError(EXIT_CODE.notFound, `No reminder with id "${id}".`);
  }
  return buildEnvelope(VERSION, "remove", EXIT_CODE.ok, `removed ${id}`, { id });
}

function commandInstall(values: Record<string, unknown>): Envelope {
  let intervalSeconds = DEFAULT_DISPATCH_INTERVAL_SECONDS;
  if (typeof values.interval === "string") {
    intervalSeconds = parseDuration(values.interval);
  }
  const notes = runInstall(intervalSeconds);
  return buildEnvelope(VERSION, "install", EXIT_CODE.ok, notes.join("\n"), { notes });
}

function commandUninstall(): Envelope {
  const notes = runUninstall();
  return buildEnvelope(VERSION, "uninstall", EXIT_CODE.ok, notes.join("\n"), { notes });
}

function runEnvelope(argv: string[], now: Date): Envelope {
  const parsed = parse(argv);
  const values = parsed.values as Record<string, unknown>;
  const command = parsed.positionals[0];
  const target = parsed.positionals[1];
  let envelope = buildEnvelope(VERSION, "help", EXIT_CODE.ok, HELP);
  if (values.version === true) {
    envelope = buildEnvelope(VERSION, "version", EXIT_CODE.ok, VERSION);
  } else if (values.help === true || command === undefined) {
    envelope = buildEnvelope(VERSION, "help", EXIT_CODE.ok, HELP);
  } else if (command === "add") {
    envelope = commandAdd(values, now);
  } else if (command === "list") {
    envelope = commandList(now);
  } else if (command === "show") {
    envelope = commandShow(requireValue(target, "id"));
  } else if (command === "ack") {
    envelope = commandAck(requireValue(target, "id"), now);
  } else if (command === "remove") {
    envelope = commandRemove(requireValue(target, "id"));
  } else if (command === "fire") {
    envelope = commandFire(requireValue(target, "id"), now);
  } else if (command === "dispatch") {
    envelope = commandDispatch(now);
  } else if (command === "banner") {
    envelope = commandBanner();
  } else if (command === "install") {
    envelope = commandInstall(values);
  } else if (command === "uninstall") {
    envelope = commandUninstall();
  } else {
    throw new NagError(EXIT_CODE.invalidInput, `Unknown command "${command}". Run nag --help.`);
  }
  return envelope;
}

export function run(argv: string[]): string {
  const envelope = runEnvelope(argv, new Date());
  let output = envelope.message;
  if (argv.includes("--json")) {
    output = JSON.stringify(envelope);
  }
  return output;
}

if (import.meta.main) {
  const now = new Date();
  const argv = process.argv.slice(2);
  const wantsJson = argv.includes("--json");
  let exitCode: ExitCode = EXIT_CODE.ok;
  try {
    const envelope = runEnvelope(argv, now);
    exitCode = envelope.code;
    if (wantsJson) {
      console.log(JSON.stringify(envelope));
    } else if (envelope.message.length > 0) {
      console.log(envelope.message);
    }
  } catch (error) {
    let code: ExitCode = EXIT_CODE.internalError;
    if (error instanceof NagError) {
      code = error.code;
    }
    exitCode = code;
    const message = (error as Error).message;
    if (wantsJson) {
      console.log(JSON.stringify(buildEnvelope(VERSION, "unknown", code, message)));
    } else {
      console.error(`nag: ${message}`);
    }
  }
  process.exit(exitCode);
}
