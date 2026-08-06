import { describe, expect, test } from "bun:test";
import {
  ALL_CHANNELS,
  describeState,
  formatDuration,
  isAcknowledged,
  isDue,
  parseChannels,
  parseDuration,
  parseStartAt,
  validateId,
  type Reminder,
} from "../src/reminder.ts";

function makeReminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: "sample",
    title: "Sample",
    message: "Body",
    page: null,
    channels: ALL_CHANNELS,
    everySeconds: 600,
    startAt: null,
    lastFiredAt: null,
    acknowledgedAt: null,
    createdAt: "2026-08-06T00:00:00.000Z",
    ...overrides,
  };
}

describe("parseDuration", () => {
  test("reads every unit", () => {
    expect(parseDuration("45s")).toBe(45);
    expect(parseDuration("10m")).toBe(600);
    expect(parseDuration("2h")).toBe(7200);
    expect(parseDuration("1d")).toBe(86400);
  });

  test("treats a bare number as seconds", () => {
    expect(parseDuration("90")).toBe(90);
  });

  test("rejects nonsense and zero", () => {
    expect(() => parseDuration("soon")).toThrow(/Invalid duration/);
    expect(() => parseDuration("0m")).toThrow(/Invalid duration/);
    expect(() => parseDuration("-5m")).toThrow(/Invalid duration/);
  });
});

describe("formatDuration", () => {
  test("picks the largest whole unit", () => {
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(600)).toBe("10m");
    expect(formatDuration(7200)).toBe("2h");
    expect(formatDuration(86400)).toBe("1d");
  });

  test("falls back to seconds when nothing divides", () => {
    expect(formatDuration(90)).toBe("90s");
  });
});

describe("parseStartAt", () => {
  const now = new Date("2026-08-06T10:00:00.000Z");

  test("reads an offset", () => {
    expect(parseStartAt("+30m", now)).toBe("2026-08-06T10:30:00.000Z");
  });

  test("reads an ISO time", () => {
    expect(parseStartAt("2026-08-07T09:00:00.000Z", now)).toBe("2026-08-07T09:00:00.000Z");
  });

  test("rejects an unreadable time", () => {
    expect(() => parseStartAt("later on", now)).toThrow(/Invalid start time/);
  });
});

describe("parseChannels", () => {
  test("reads a comma list", () => {
    expect(parseChannels("dialog,terminal")).toEqual(["dialog", "terminal"]);
  });

  test("ignores spacing and case", () => {
    expect(parseChannels(" Dialog , NOTIFICATION ")).toEqual(["dialog", "notification"]);
  });

  test("rejects an unknown channel", () => {
    expect(() => parseChannels("dialog,pager")).toThrow(/Unknown channel/);
  });

  test("rejects an empty list", () => {
    expect(() => parseChannels(" , ")).toThrow(/No channels/);
  });
});

describe("validateId", () => {
  test("accepts a slug", () => {
    expect(validateId("sprint-mentions-2026-08-06")).toBe("sprint-mentions-2026-08-06");
  });

  test("rejects spaces, capitals, and a leading dash", () => {
    expect(() => validateId("has space")).toThrow(/Invalid id/);
    expect(() => validateId("HasCapital")).toThrow(/Invalid id/);
    expect(() => validateId("-leading")).toThrow(/Invalid id/);
  });
});

describe("isDue", () => {
  const now = new Date("2026-08-06T12:00:00.000Z");

  test("a fresh reminder is due", () => {
    expect(isDue(makeReminder(), now)).toBe(true);
  });

  test("an acknowledged reminder is never due", () => {
    const reminder = makeReminder({ acknowledgedAt: "2026-08-06T11:00:00.000Z" });
    expect(isDue(reminder, now)).toBe(false);
    expect(isAcknowledged(reminder)).toBe(true);
  });

  test("waits for startAt", () => {
    expect(isDue(makeReminder({ startAt: "2026-08-06T13:00:00.000Z" }), now)).toBe(false);
    expect(isDue(makeReminder({ startAt: "2026-08-06T11:00:00.000Z" }), now)).toBe(true);
  });

  test("waits a full interval after the last fire", () => {
    const justFired = makeReminder({ lastFiredAt: "2026-08-06T11:55:00.000Z" });
    expect(isDue(justFired, now)).toBe(false);
    const longAgo = makeReminder({ lastFiredAt: "2026-08-06T11:45:00.000Z" });
    expect(isDue(longAgo, now)).toBe(true);
  });

  test("fires exactly on the boundary", () => {
    const onBoundary = makeReminder({ lastFiredAt: "2026-08-06T11:50:00.000Z" });
    expect(isDue(onBoundary, now)).toBe(true);
  });
});

describe("describeState", () => {
  const now = new Date("2026-08-06T12:00:00.000Z");

  test("names each state", () => {
    expect(describeState(makeReminder({ acknowledgedAt: "x" }), now)).toBe("acknowledged");
    expect(describeState(makeReminder(), now)).toBe("due now");
    expect(describeState(makeReminder({ startAt: "2026-08-06T13:00:00.000Z" }), now)).toContain("waits until");
    expect(describeState(makeReminder({ lastFiredAt: "2026-08-06T11:59:00.000Z" }), now)).toBe("every 10m");
  });
});
