import { describe, expect, it } from "vitest";

import { validateAddress } from "@/lib/arc/usdc";

describe("validateAddress", () => {
  it("accepts a valid lower-case EVM address", () => {
    expect(validateAddress("0x1111111111111111111111111111111111111111")).toBe(
      "0x1111111111111111111111111111111111111111",
    );
  });

  it("accepts a valid checksummed EVM address and lower-cases it", () => {
    const checksummed = "0x52908400098527886E0F7030069857D2E4169EE7";
    expect(validateAddress(checksummed)).toBe(checksummed.toLowerCase());
  });

  it("rejects an invalid address", () => {
    for (const value of ["", "0x123", "not-an-address", "1111...", "0xGG"]) {
      expect(() => validateAddress(value)).toThrow();
    }
  });
});
