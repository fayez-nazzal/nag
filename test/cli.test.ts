import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VERSION, run } from "../src/cli.ts";
import { loadReminder } from "../src/store.ts";

let home = "";
let previousHome: string | undefined;

const ADD_ARGS = [
  "add",
  "--id",
  "sprint",
  "--title",
  "Sprint input is overdue",
  "--message",
  "Three stories are waiting on you.",
];

beforeEach(() => {
  previousHome = process.env.NAG_HOME;
  home = mkdtempSync(join(tmpdir(), "nag-cli-"));
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

describe("global flags", () => {
  test("prints the version", () => {
    expect(run(["--version"])).toBe(VERSION);
  });

  test("prints help with no command", () => {
    expect(run([])).toContain("USAGE");
  });

  test("rejects an unknown command", () => {
    expect(() => run(["explode"])).toThrow(/Unknown command/);
  });
});

describe("add", () => {
  test("writes a reminder with the defaults", () => {
    run(ADD_ARGS);
    const reminder = loadReminder("sprint");
    expect(reminder?.title).toBe("Sprint input is overdue");
    expect(reminder?.everySeconds).toBe(600);
    expect(reminder?.channels).toEqual(["dialog", "terminal"]);
    expect(reminder?.page).toBeNull();
    expect(reminder?.acknowledgedAt).toBeNull();
  });

  test("takes an interval, a page, and a channel list", () => {
    run([...ADD_ARGS, "--every", "2h", "--page", "/tmp/brief.html", "--channel", "dialog,terminal"]);
    const reminder = loadReminder("sprint");
    expect(reminder?.everySeconds).toBe(7200);
    expect(reminder?.page).toBe("/tmp/brief.html");
    expect(reminder?.channels).toEqual(["dialog", "terminal"]);
  });

  test("holds a reminder until a start time", () => {
    run([...ADD_ARGS, "--start-at", "+30m"]);
    expect(loadReminder("sprint")?.startAt).not.toBeNull();
  });

  test("refuses a missing id, title, or message", () => {
    expect(() => run(["add", "--title", "t", "--message", "m"])).toThrow(/Missing --id/);
    expect(() => run(["add", "--id", "x", "--message", "m"])).toThrow(/Missing --title/);
    expect(() => run(["add", "--id", "x", "--title", "t"])).toThrow(/Missing --message/);
  });

  test("refuses a bad id and a bad interval", () => {
    expect(() => run(["add", "--id", "Bad Id", "--title", "t", "--message", "m"])).toThrow(/Invalid id/);
    expect(() => run([...ADD_ARGS, "--every", "soon"])).toThrow(/Invalid duration/);
  });
});

describe("list, show, ack, remove", () => {
  test("lists nothing before anything is added", () => {
    expect(run(["list"])).toBe("no reminders");
  });

  test("marks a pending reminder and drops the mark once acknowledged", () => {
    run(ADD_ARGS);
    expect(run(["list"])).toContain("* sprint");
    run(["ack", "sprint"]);
    expect(run(["list"])).not.toContain("* sprint");
    expect(run(["list"])).toContain("acknowledged");
  });

  test("shows a reminder as JSON", () => {
    run(ADD_ARGS);
    expect(JSON.parse(run(["show", "sprint"])).id).toBe("sprint");
  });

  test("removes a reminder and says so when it was not there", () => {
    run(ADD_ARGS);
    expect(run(["remove", "sprint"])).toBe("removed sprint");
    expect(run(["remove", "sprint"])).toContain("no reminder");
  });

  test("complains about an id that does not exist", () => {
    expect(() => run(["show", "ghost"])).toThrow(/No reminder/);
    expect(() => run(["ack", "ghost"])).toThrow(/No reminder/);
  });

  test("needs an id for the commands that take one", () => {
    expect(() => run(["ack"])).toThrow(/Missing --id/);
  });
});

describe("banner", () => {
  test("is empty until a reminder is pending, and mentions how to clear it", () => {
    expect(run(["banner"])).toBe("");
    run(ADD_ARGS);
    expect(run(["banner"])).toContain("nag ack sprint");
    run(["ack", "sprint"]);
    expect(run(["banner"])).toBe("");
  });
});

describe("fire and dispatch", () => {
  test("fire refires a reminder immediately, ignoring the schedule", () => {
    run([...ADD_ARGS, "--channel", "terminal"]);
    expect(run(["fire", "sprint"])).toBe("fired sprint");
    expect(loadReminder("sprint")?.lastFiredAt).not.toBeNull();
  });

  test("dispatch reports how many reminders it fired", () => {
    run([...ADD_ARGS, "--channel", "terminal"]);
    expect(run(["dispatch"])).toBe("fired 1");
  });
});
