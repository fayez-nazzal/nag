import { describe, expect, test } from "bun:test";
import {
  AGENT_LABEL,
  ZSHRC_BEGIN,
  ZSHRC_COMMAND,
  ZSHRC_END,
  addZshrcBlock,
  buildPlist,
  buildZshrcBlock,
  hasZshrcBlock,
  removeZshrcBlock,
  type PlistOptions,
} from "../src/install.ts";

function makeOptions(overrides: Partial<PlistOptions> = {}): PlistOptions {
  return {
    label: AGENT_LABEL,
    bunPath: "/Users/someone/.bun/bin/bun",
    cliPath: "/Users/someone/repos/nag/src/cli.ts",
    intervalSeconds: 60,
    outLog: "/Users/someone/.nag/logs/launchd.out.log",
    errLog: "/Users/someone/.nag/logs/launchd.err.log",
    ...overrides,
  };
}

describe("buildPlist", () => {
  test("runs the dispatcher through bun", () => {
    const plist = buildPlist(makeOptions());
    expect(plist).toContain("<string>/Users/someone/.bun/bin/bun</string>");
    expect(plist).toContain("<string>/Users/someone/repos/nag/src/cli.ts</string>");
    expect(plist).toContain("<string>dispatch</string>");
  });

  test("wakes on the given interval and survives a reboot", () => {
    const plist = buildPlist(makeOptions({ intervalSeconds: 300 }));
    expect(plist).toContain("<integer>300</integer>");
    expect(plist).toContain("<key>RunAtLoad</key>");
    expect(plist).toContain("<true/>");
  });

  test("escapes XML in a path", () => {
    const plist = buildPlist(makeOptions({ cliPath: "/tmp/a&b/cli.ts" }));
    expect(plist).toContain("/tmp/a&amp;b/cli.ts");
  });
});

describe("zshrc block", () => {
  test("is fenced by markers", () => {
    const block = buildZshrcBlock();
    expect(block.startsWith(ZSHRC_BEGIN)).toBe(true);
    expect(block.endsWith(ZSHRC_END)).toBe(true);
    expect(block).toContain(ZSHRC_COMMAND);
  });

  test("adds once and stays put on a second add", () => {
    const first = addZshrcBlock("export PATH=/bin\n");
    const second = addZshrcBlock(first);
    expect(first).toBe(second);
    expect(first.match(new RegExp(ZSHRC_BEGIN, "g"))).toHaveLength(1);
    expect(hasZshrcBlock(first)).toBe(true);
  });

  test("keeps the original content when adding", () => {
    expect(addZshrcBlock("export PATH=/bin\n")).toContain("export PATH=/bin");
  });

  test("handles an empty rc file", () => {
    expect(addZshrcBlock("")).toBe(`${buildZshrcBlock()}\n`);
  });

  test("removes the block and leaves everything else", () => {
    const withBlock = addZshrcBlock("export PATH=/bin\nalias l=ls\n");
    const cleaned = removeZshrcBlock(withBlock);
    expect(cleaned).toContain("export PATH=/bin");
    expect(cleaned).toContain("alias l=ls");
    expect(hasZshrcBlock(cleaned)).toBe(false);
    expect(cleaned).not.toContain(ZSHRC_COMMAND);
  });

  test("removing from a file that never had it changes nothing meaningful", () => {
    expect(removeZshrcBlock("alias l=ls")).toBe("alias l=ls");
  });
});
