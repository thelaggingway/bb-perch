import { describe, expect, it } from "vitest";
import { parseUsage } from "../usage.ts";

const pro = `Perch Tokens
- Plan: Pro · Roost: Unlimited · Manual: 75,000 PT (up to $75 API usage)
- Roost      Unlimited monthly · fair-use limits
- 5h         0% · Fair use
- Weekly     0% · Fair use · resets in 3d 7h
- Manual     █████░░░░░░░░░░░░░░░░░░░ 15,986 PT / 75,000 PT · 21%
- 5h         25% · Fair use · resets in 3h
- Weekly     32% · Fair use · resets in 3d 7h
- Bonus      ░░░░░░░░░░░░░░░░░░░░░░░░ DeepSeek V4.1 Flash 1017 · 74,516 of 75,000 PT left · up to 7,500 PT every 5 hours · ends Dec 1
- Activity   728 chats this month · 15,881 PT in 7 days · 12,260,881 model tokens

Usage this session
- Calls: 0
- Tokens: 0 total (0 input · 0 output)`;

describe("parseUsage", () => {
  it("turns Perch /usage text into labelled windows", () => {
    const now = Date.parse("2026-11-19T10:00:00Z");
    const usage = parseUsage(pro, now);
    expect(usage.planLabel).toBe("Pro");
    expect(usage.activity).toBe("728 chats this month · 15,881 PT in 7 days · 12,260,881 model tokens");
    expect(usage.windows.map((w) => [w.label, w.usedPercent])).toEqual([
      ["Roost · 5h", 0],
      ["Roost · Weekly", 0],
      ["Manual", 21],
      ["Manual · 5h", 25],
      ["Manual · Weekly", 32],
      ["Bonus", 0.6],
    ]);
    expect(usage.windows[1].resetsAt).toBe("2026-11-22T17:00:00.000Z");
    expect(usage.windows[3].resetsAt).toBe("2026-11-19T13:00:00.000Z");
    expect(usage.windows[2].cost).toEqual({ usedUsdCents: 1599, limitUsdCents: 7500 });
    expect(usage.windows[5].cost).toBeUndefined();
  });

  it("returns no windows for unrelated text", () => {
    expect(parseUsage("hello").windows).toEqual([]);
  });
});
