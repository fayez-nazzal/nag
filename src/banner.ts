import type { Reminder } from "./reminder.ts";
import { isAcknowledged } from "./reminder.ts";

const HIGHLIGHT = "\u001b[1;41m";
const RESET = "\u001b[0m";

export function pendingForBanner(reminders: Reminder[]): Reminder[] {
  return reminders.filter((reminder) => {
    return !isAcknowledged(reminder) && reminder.channels.includes("terminal");
  });
}

export function bannerLines(reminder: Reminder): string[] {
  const headline = reminder.message.split("\n").filter((line) => line.trim().length > 0)[0];
  const lines = [`${HIGHLIGHT}  ${reminder.title.toUpperCase()}  ${RESET}`];
  if (headline !== undefined) {
    lines.push(`  ${headline}`);
  }
  if (reminder.page !== null) {
    lines.push(`  Open:   open ${reminder.page}`);
  }
  lines.push(`  Clear:  nag ack ${reminder.id}`);
  return lines;
}

export function renderBanner(reminders: Reminder[]): string {
  const pending = pendingForBanner(reminders);
  let banner = "";
  if (pending.length > 0) {
    const blocks = pending.map((reminder) => bannerLines(reminder).join("\n"));
    banner = `\n${blocks.join("\n\n")}\n`;
  }
  return banner;
}
