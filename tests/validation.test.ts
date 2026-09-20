import { describe, expect, it } from "vitest";

import { validateCreatePaymentInput } from "@/lib/payments/validation";

const RECIPIENT = "0x1111111111111111111111111111111111111111";

describe("validateCreatePaymentInput", () => {
  it("accepts a valid payload and canonicalises the amount", () => {
    const result = validateCreatePaymentInput({
      amountUsdc: "5.00",
      description: "Design work",
      recipient: RECIPIENT,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.amountUsdc).toBe("5.000000");
      expect(result.value.amountBaseUnits).toBe("5000000");
      expect(result.value.recipient).toBe(RECIPIENT);
      expect(result.value.description).toBe("Design work");
    }
  });

  it("rejects an invalid amount", () => {
    const result = validateCreatePaymentInput({
      amountUsdc: "1.0000001",
      description: "Design work",
      recipient: RECIPIENT,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((issue) => issue.field === "amountUsdc")).toBe(
        true,
      );
    }
  });

  it("rejects an invalid recipient", () => {
    const result = validateCreatePaymentInput({
      amountUsdc: "5",
      description: "Design work",
      recipient: "not-an-address",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((issue) => issue.field === "recipient")).toBe(
        true,
      );
    }
  });

  it("rejects missing fields", () => {
    const result = validateCreatePaymentInput({});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const fields = result.errors.map((issue) => issue.field).sort();
      expect(fields).toEqual(["amountUsdc", "description", "recipient"]);
    }
  });

  it("rejects a non-object body", () => {
    expect(validateCreatePaymentInput(null).ok).toBe(false);
    expect(validateCreatePaymentInput("nope").ok).toBe(false);
  });
});
