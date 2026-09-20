import { describe, expect, it } from "vitest";

import {
  formatUsdcAmount,
  parseUsdcAmount,
  UsdcAmountError,
  validateUsdcAmount,
} from "@/lib/arc/usdc";

describe("parseUsdcAmount", () => {
  it("converts whole USDC to base units", () => {
    expect(parseUsdcAmount("1")).toBe(1_000_000n);
  });

  it("converts one and a half", () => {
    expect(parseUsdcAmount("1.5")).toBe(1_500_000n);
  });

  it("converts 5.00", () => {
    expect(parseUsdcAmount("5.00")).toBe(5_000_000n);
  });

  it("converts the smallest unit", () => {
    expect(parseUsdcAmount("0.000001")).toBe(1n);
  });

  it("ignores surrounding whitespace", () => {
    expect(parseUsdcAmount("  2.25  ")).toBe(2_250_000n);
  });

  it("rejects more than 6 decimal places", () => {
    expect(() => parseUsdcAmount("1.0000001")).toThrow(UsdcAmountError);
  });

  it("rejects zero", () => {
    expect(() => parseUsdcAmount("0")).toThrow(UsdcAmountError);
    expect(() => parseUsdcAmount("0.00")).toThrow(UsdcAmountError);
  });

  it("rejects negative amounts", () => {
    expect(() => parseUsdcAmount("-1")).toThrow(UsdcAmountError);
    expect(() => parseUsdcAmount("-0.5")).toThrow(UsdcAmountError);
  });

  it("rejects malformed input", () => {
    for (const value of ["", "abc", "1.2.3", ".5", "1.", "1e3", "1,5"]) {
      expect(() => parseUsdcAmount(value)).toThrow(UsdcAmountError);
    }
  });
});

describe("formatUsdcAmount", () => {
  it("formats base units with 6 decimals", () => {
    expect(formatUsdcAmount(5_000_000n)).toBe("5.000000");
    expect(formatUsdcAmount(1_500_000n)).toBe("1.500000");
    expect(formatUsdcAmount(1n)).toBe("0.000001");
  });

  it("round-trips through parse and format", () => {
    for (const value of [
      "1",
      "1.5",
      "5.00",
      "0.000001",
      "1234.567890",
      "1.000000",
    ]) {
      const baseUnits = parseUsdcAmount(value);
      expect(parseUsdcAmount(formatUsdcAmount(baseUnits))).toBe(baseUnits);
    }
  });
});

describe("validateUsdcAmount", () => {
  it("accepts an amount at the maximum", () => {
    expect(validateUsdcAmount("1000000")).toBe(1_000_000_000_000n);
  });

  it("rejects an amount above the maximum", () => {
    expect(() => validateUsdcAmount("1000001")).toThrow(UsdcAmountError);
  });
});
