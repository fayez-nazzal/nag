#!/usr/bin/env bun

import { parseArgs } from "node:util";
import { renderBanner } from "./banner.ts";
import { dispatch, fireReminder } from "./dispatch.ts";
import { DEFAULT_DISPATCH_INTERVAL_SECONDS, runInstall, runUninstall } from "./install.ts";
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
} from "./reminder.ts";
import { listReminders, loadReminder, removeReminder, saveReminder } from "./store.ts";

export const VERSION = "0.1.0";

const HELP = `nag ${VERSION} — persistent reminders that keep coming back until you handle them

USAGE
  nag <command> [options]

  A reminder lives in ~/.nag/reminders as one JSON file. A single launchd
  agent wakes on an interval, fires whatever is due, and survives a reboot.
  A reminder stops only when you acknowledge it.

COMMANDS
  add                 Create or replace a reminder
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
      --page <path|url>  Opened by the Open button, and named in the banner
      --every <duration> Repeat interval, forms like 45s 10m 2h 1d (default ${formatDuration(DEFAULT_EVERY_SECONDS)})
      --start-at <when>  ISO time, or an offset like +30m, to hold it until then
      --channel <list>   Comma list from ${ALL_CHANNELS.join(", ")} (default all)

INSTALL OPTIONS
      --interval <duration>  How often launchd wakes the dispatcher (default ${formatDuration(DEFAULT_DISPATCH_INTERVAL_SECONDS)})

GLOBAL
  -h, --help            Show this help
  -v, --version         Show version

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
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
    },
    allowPositionals: true,
  });
}

function requireValue(value: string | undefined, name: string): string {
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing --${name}.`);
  }
  return value;
}

function requireReminder(id: string): Reminder {
  const reminder = loadReminder(id);
  if (reminder === null) {
    throw new Error(`No reminder with id "${id}".`);
  }
  return reminder;
}

function commandAdd(values: Record<string, unknown>): string {
  const id = validateId(requireValue(values.id as string | undefined, "id"));
  const now = new Date();
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
  return `added ${id}, repeats every ${formatDuration(everySeconds)} on ${channels.join(", ")}`;
}

function commandList(): string {
  const now = new Date();
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
  return output;
}

function commandBanner(): string {
  return renderBanner(listReminders().reminders);
}

function commandDispatch(): string {
  const result = dispatch(new Date());
  return `fired ${result.fired.length}`;
}

function commandFire(id: string): string {
  const reminder = requireReminder(id);
  fireReminder(reminder, new Date());
  return `fired ${id}`;
}

function commandAck(id: string): string {
  const reminder = requireReminder(id);
  reminder.acknowledgedAt = new Date().toISOString();
  saveReminder(reminder);
  return `acknowledged ${id}`;
}

function commandRemove(id: string): string {
  const removed = removeReminder(id);
  let message = `no reminder with id "${id}"`;
  if (removed) {
    message = `removed ${id}`;
  }
  return message;
}

function commandInstall(values: Record<string, unknown>): string {
  let intervalSeconds = DEFAULT_DISPATCH_INTERVAL_SECONDS;
  if (typeof values.interval === "string") {
    intervalSeconds = parseDuration(values.interval);
  }
  return runInstall(intervalSeconds).join("\n");
}

export function run(argv: string[]): string {
  const parsed = parse(argv);
  const values = parsed.values as Record<string, unknown>;
  const command = parsed.positionals[0];
  const target = parsed.positionals[1];
  let output = HELP;
  if (values.version === true) {
    output = VERSION;
  } else if (values.help === true || command === undefined) {
    output = HELP;
  } else if (command === "add") {
    output = commandAdd(values);
  } else if (command === "list") {
    output = commandList();
  } else if (command === "show") {
    output = JSON.stringify(requireReminder(requireValue(target, "id")), null, 2);
  } else if (command === "ack") {
    output = commandAck(requireValue(target, "id"));
  } else if (command === "remove") {
    output = commandRemove(requireValue(target, "id"));
  } else if (command === "fire") {
    output = commandFire(requireValue(target, "id"));
  } else if (command === "dispatch") {
    output = commandDispatch();
  } else if (command === "banner") {
    output = commandBanner();
  } else if (command === "install") {
    output = commandInstall(values);
  } else if (command === "uninstall") {
    output = runUninstall().join("\n");
  } else {
    throw new Error(`Unknown command "${command}". Run nag --help.`);
  }
  return output;
}

if (import.meta.main) {
  try {
    const output = run(process.argv.slice(2));
    if (output.length > 0) {
      console.log(output);
    }
  } catch (error) {
    console.error(`nag: ${(error as Error).message}`);
    process.exit(1);
  }
}
