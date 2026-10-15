import { describe, expect, it } from "vitest";
import { formatHours, roundHours } from "./duration";

describe("duration", () => {
  it("reads decimal hours as hours and minutes", () => {
    expect(formatHours(0.5)).toBe("30m");
    expect(formatHours(1)).toBe("1h");
    expect(formatHours(1.25)).toBe("1h 15m");
    expect(formatHours(8.5)).toBe("8h 30m");
    expect(formatHours(44)).toBe("44h");
    expect(formatHours(0)).toBe("0h");
    expect(formatHours(-0.75)).toBe("−45m");
  });

  it("rounds to the minute without float noise", () => {
    expect(roundHours(0.1 + 0.2)).toBe(0.3);
    expect(roundHours(2.25)).toBe(2.25);
    expect(formatHours(193.6)).toBe("193h 36m");
  });
});
