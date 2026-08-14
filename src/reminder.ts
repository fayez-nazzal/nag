export type Channel = "dialog" | "terminal";

export type Reminder = {
  id: string;
  title: string;
  message: string;
  page: string | null;
  channels: Channel[];
  everySeconds: number;
  startAt: string | null;
  lastFiredAt: string | null;
  lastDeliveredAt: string | null;
  lastDeliveryError: string | null;
  acknowledgedAt: string | null;
  createdAt: string;
};

export const ALL_CHANNELS: Channel[] = ["dialog", "terminal"];

export const DEFAULT_EVERY_SECONDS = 600;

const SECONDS_PER_UNIT: Record<string, number> = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
};

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

const DURATION_PATTERN = /^(\d+)([smhd]?)$/;

export function parseDuration(text: string): number {
  const match = DURATION_PATTERN.exec(text.trim());
  let seconds = 0;
  if (match !== null) {
    const amount = Number(match[1]);
    let unit = match[2];
    if (unit === "") {
      unit = "s";
    }
    seconds = amount * SECONDS_PER_UNIT[unit]!;
  }
  if (seconds <= 0) {
    throw new Error(`Invalid duration "${text}". Use forms like 45s, 10m, 2h, 1d.`);
  }
  return seconds;
}

export function formatDuration(seconds: number): string {
  let result = `${seconds}s`;
  if (seconds % SECONDS_PER_UNIT.d! === 0) {
    result = `${seconds / SECONDS_PER_UNIT.d!}d`;
  } else if (seconds % SECONDS_PER_UNIT.h! === 0) {
    result = `${seconds / SECONDS_PER_UNIT.h!}h`;
  } else if (seconds % SECONDS_PER_UNIT.m! === 0) {
    result = `${seconds / SECONDS_PER_UNIT.m!}m`;
  }
  return result;
}

export function parseStartAt(text: string, now: Date): string {
  let startedAt = "";
  if (text.startsWith("+")) {
    const offsetSeconds = parseDuration(text.slice(1));
    startedAt = new Date(now.getTime() + offsetSeconds * 1000).toISOString();
  } else {
    const parsed = Date.parse(text);
    if (Number.isNaN(parsed)) {
      throw new Error(`Invalid start time "${text}". Use an ISO date or an offset like +30m.`);
    }
    startedAt = new Date(parsed).toISOString();
  }
  return startedAt;
}

export function parseChannels(text: string): Channel[] {
  const requested = text
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0);
  const unknown = requested.filter((part) => !ALL_CHANNELS.includes(part as Channel));
  if (unknown.length > 0) {
    throw new Error(`Unknown channel "${unknown[0]}". Known channels: ${ALL_CHANNELS.join(", ")}.`);
  }
  if (requested.length === 0) {
    throw new Error("No channels given.");
  }
  return requested as Channel[];
}

export function validateId(id: string): string {
  if (!ID_PATTERN.test(id)) {
    throw new Error(`Invalid id "${id}". Use lower case letters, digits, dot, dash, underscore.`);
  }
  return id;
}

export function isAcknowledged(reminder: Reminder): boolean {
  return reminder.acknowledgedAt !== null;
}

export function isDue(reminder: Reminder, now: Date): boolean {
  let due = !isAcknowledged(reminder);
  if (due && reminder.startAt !== null) {
    due = now.getTime() >= Date.parse(reminder.startAt);
  }
  if (due && reminder.lastFiredAt !== null) {
    const nextFireAt = Date.parse(reminder.lastFiredAt) + reminder.everySeconds * 1000;
    due = now.getTime() >= nextFireAt;
  }
  return due;
}

export function describeState(reminder: Reminder, now: Date): string {
  let state = `every ${formatDuration(reminder.everySeconds)}`;
  if (isAcknowledged(reminder)) {
    state = "acknowledged";
  } else if (isDue(reminder, now)) {
    state = "due now";
  } else if (reminder.startAt !== null && now.getTime() < Date.parse(reminder.startAt)) {
    state = `waits until ${reminder.startAt}`;
  }
  return state;
}
