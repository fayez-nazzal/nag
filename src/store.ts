import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Reminder } from "./reminder.ts";

export function rootDir(): string {
  let root = join(homedir(), ".nag");
  const override = process.env.NAG_HOME;
  if (override !== undefined && override.length > 0) {
    root = override;
  }
  return root;
}

export function remindersDir(): string {
  return join(rootDir(), "reminders");
}

export function locksDir(): string {
  return join(rootDir(), "locks");
}

export function logsDir(): string {
  return join(rootDir(), "logs");
}

export function logPath(): string {
  return join(logsDir(), "dispatch.log");
}

export function reminderPath(id: string): string {
  return join(remindersDir(), `${id}.json`);
}

export function lockPath(id: string): string {
  return join(locksDir(), `${id}.lock`);
}

export function ensureDirs(): void {
  mkdirSync(remindersDir(), { recursive: true });
  mkdirSync(locksDir(), { recursive: true });
  mkdirSync(logsDir(), { recursive: true });
}

export function saveReminder(reminder: Reminder): void {
  ensureDirs();
  writeFileSync(reminderPath(reminder.id), `${JSON.stringify(reminder, null, 2)}\n`);
}

export function loadReminder(id: string): Reminder | null {
  const path = reminderPath(id);
  let reminder: Reminder | null = null;
  if (existsSync(path)) {
    reminder = JSON.parse(readFileSync(path, "utf8")) as Reminder;
  }
  return reminder;
}

export function listReminders(): Reminder[] {
  const dir = remindersDir();
  const reminders: Reminder[] = [];
  if (existsSync(dir)) {
    const names = readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .sort();
    for (const name of names) {
      reminders.push(JSON.parse(readFileSync(join(dir, name), "utf8")) as Reminder);
    }
  }
  return reminders;
}

export function removeReminder(id: string): boolean {
  const path = reminderPath(id);
  let removed = false;
  if (existsSync(path)) {
    rmSync(path);
    removed = true;
  }
  return removed;
}

export function appendLog(line: string): void {
  ensureDirs();
  appendFileSync(logPath(), `${new Date().toISOString()} ${line}\n`);
}
