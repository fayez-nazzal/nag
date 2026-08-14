import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ALL_CHANNELS, type Reminder } from "../src/reminder.ts";
import {
  appendLog,
  listReminders,
  loadReminder,
  logPath,
  reminderPath,
  removeReminder,
  rootDir,
  saveReminder,
} from "../src/store.ts";

let home = "";
let previousHome: string | undefined;

function makeReminder(id: string): Reminder {
  return {
    id,
    title: `Title ${id}`,
    message: "Body",
    page: null,
    channels: ALL_CHANNELS,
    everySeconds: 600,
    startAt: null,
    lastFiredAt: null,
    acknowledgedAt: null,
    createdAt: "2026-08-06T00:00:00.000Z",
  };
}

beforeEach(() => {
  previousHome = process.env.NAG_HOME;
  home = mkdtempSync(join(tmpdir(), "nag-test-"));
  process.env.NAG_HOME = home;
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  if (previousHome === undefined) {
    delete process.env.NAG_HOME;
  } else {
    process.env.NAG_HOME = previousHome;
  }
});

describe("store", () => {
  test("honours NAG_HOME", () => {
    expect(rootDir()).toBe(home);
    expect(reminderPath("abc")).toBe(join(home, "reminders", "abc.json"));
  });

  test("round trips a reminder", () => {
    const reminder = makeReminder("alpha");
    saveReminder(reminder);
    expect(loadReminder("alpha")).toEqual(reminder);
  });

  test("returns null for a reminder that is not there", () => {
    expect(loadReminder("missing")).toBeNull();
  });

  test("lists reminders sorted by id", () => {
    saveReminder(makeReminder("beta"));
    saveReminder(makeReminder("alpha"));
    expect(listReminders().map((reminder) => reminder.id)).toEqual(["alpha", "beta"]);
  });

  test("lists nothing before anything is saved", () => {
    expect(listReminders()).toEqual([]);
  });

  test("removes a reminder and reports whether it was there", () => {
    saveReminder(makeReminder("alpha"));
    expect(removeReminder("alpha")).toBe(true);
    expect(removeReminder("alpha")).toBe(false);
    expect(loadReminder("alpha")).toBeNull();
  });

  test("appends timestamped log lines", () => {
    appendLog("fire alpha");
    appendLog("fire beta");
    const lines = readFileSync(logPath(), "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("fire alpha");
    expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("path traversal guard", () => {
  test("reminderPath rejects an id that would escape the reminders directory", () => {
    expect(() => reminderPath("../../../tmp/x")).toThrow(/Invalid id/);
  });

  test("removeReminder never touches a file outside the reminders directory", () => {
    const sentinel = join(home, "..", "sentinel-should-survive");
    writeFileSync(sentinel, "keep me");
    expect(() => removeReminder("../sentinel-should-survive")).toThrow(/Invalid id/);
    expect(readFileSync(sentinel, "utf8")).toBe("keep me");
    rmSync(sentinel, { force: true });
  });
});
