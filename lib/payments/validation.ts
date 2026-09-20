import {
  formatUsdcAmount,
  parseUsdcAmount,
  validateAddress,
} from "@/lib/arc/usdc";

export interface CreatePaymentInput {
  amountUsdc: string;
  amountBaseUnits: string;
  description: string;
  recipient: `0x${string}`;
}

export interface ValidationIssue {
  field: "amountUsdc" | "description" | "recipient";
  message: string;
}

export type ValidationResult =
  | { ok: true; value: CreatePaymentInput }
  | { ok: false; errors: ValidationIssue[] };

export const MAX_DESCRIPTION_LENGTH = 200;

/**
 * Validate an untrusted create-payment payload. Never trusts a client-provided
 * status; callers always create records as PENDING.
 */
export function validateCreatePaymentInput(raw: unknown): ValidationResult {
  const errors: ValidationIssue[] = [];

  if (typeof raw !== "object" || raw === null) {
    return {
      ok: false,
      errors: [{ field: "amountUsdc", message: "Request body must be JSON" }],
    };
  }

  const body = raw as Record<string, unknown>;

  const rawAmount = body.amountUsdc;
  const rawDescription = body.description;
  const rawRecipient = body.recipient;

  let amountUsdc = "";
  let amountBaseUnits = "";

  if (typeof rawAmount !== "string" || rawAmount.trim().length === 0) {
    errors.push({ field: "amountUsdc", message: "Amount is required" });
  } else {
    try {
      const baseUnits = parseUsdcAmount(rawAmount);
      amountBaseUnits = baseUnits.toString();
      amountUsdc = formatUsdcAmount(baseUnits);
    } catch (error) {
      errors.push({
        field: "amountUsdc",
        message: error instanceof Error ? error.message : "Invalid amount",
      });
    }
  }

  const description =
    typeof rawDescription === "string" ? rawDescription.trim() : "";
  if (description.length === 0) {
    errors.push({ field: "description", message: "Description is required" });
  } else if (description.length > MAX_DESCRIPTION_LENGTH) {
    errors.push({
      field: "description",
      message: `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer`,
    });
  }

  let recipient: `0x${string}` | null = null;
  if (typeof rawRecipient !== "string" || rawRecipient.trim().length === 0) {
    errors.push({ field: "recipient", message: "Recipient is required" });
  } else {
    try {
      recipient = validateAddress(rawRecipient);
    } catch (error) {
      errors.push({
        field: "recipient",
        message: error instanceof Error ? error.message : "Invalid recipient",
      });
    }
  }

  if (errors.length > 0 || recipient === null) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: { amountUsdc, amountBaseUnits, description, recipient },
  };
}
