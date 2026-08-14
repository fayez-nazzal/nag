import { describe, expect, test } from "bun:test";
import { bannerLines, pendingForBanner, renderBanner } from "../src/banner/banner.ts";
import { ALL_CHANNELS, type Reminder } from "../src/obligation/reminder.ts";

function makeReminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: "sample",
    title: "Sample title",
    message: "First line\nSecond line",
    page: null,
    channels: ALL_CHANNELS,
    everySeconds: 600,
    startAt: null,
    lastFiredAt: null,
    lastDeliveredAt: null,
    lastDeliveryError: null,
    acknowledgedAt: null,
    createdAt: "2026-08-06T00:00:00.000Z",
    ...overrides,
  };
}

describe("pendingForBanner", () => {
  test("keeps only unacknowledged reminders on the terminal channel", () => {
    const reminders = [
      makeReminder({ id: "keep" }),
      makeReminder({ id: "done", acknowledgedAt: "2026-08-06T01:00:00.000Z" }),
      makeReminder({ id: "dialog-only", channels: ["dialog"] }),
    ];
    expect(pendingForBanner(reminders).map((reminder) => reminder.id)).toEqual(["keep"]);
  });
});

describe("bannerLines", () => {
  test("shows the title, the first message line, and how to clear it", () => {
    const lines = bannerLines(makeReminder());
    expect(lines[0]).toContain("SAMPLE TITLE");
    expect(lines.join("\n")).toContain("First line");
    expect(lines.join("\n")).not.toContain("Second line");
    expect(lines.join("\n")).toContain("nag ack sample");
  });

  test("names the page only when one is attached", () => {
    expect(bannerLines(makeReminder()).join("\n")).not.toContain("Open:");
    expect(bannerLines(makeReminder({ page: "/tmp/page.html" })).join("\n")).toContain("open /tmp/page.html");
  });

  test("survives a message that is only blank lines", () => {
    const lines = bannerLines(makeReminder({ message: "\n \n" }));
    expect(lines.join("\n")).toContain("nag ack sample");
  });
});

describe("renderBanner", () => {
  test("prints nothing when nothing is pending", () => {
    expect(renderBanner([])).toBe("");
    expect(renderBanner([makeReminder({ acknowledgedAt: "2026-08-06T01:00:00.000Z" })])).toBe("");
  });

  test("prints a block per pending reminder", () => {
    const banner = renderBanner([makeReminder({ id: "one" }), makeReminder({ id: "two" })]);
    expect(banner).toContain("nag ack one");
    expect(banner).toContain("nag ack two");
  });
});
