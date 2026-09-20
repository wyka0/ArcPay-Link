import { isAddress, type Address } from "viem";

import { ARC_USDC_DECIMALS } from "./config";

/** Raised when a USDC amount cannot be represented exactly on-chain. */
export class UsdcAmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsdcAmountError";
  }
}

/**
 * Largest amount this MVP will accept for a single payment link (in USDC).
 * Keeps accidental/maliciously huge requests out of the system.
 */
export const MAX_USDC_AMOUNT = 1_000_000n; // 1,000,000 USDC

const DECIMALS = BigInt(ARC_USDC_DECIMALS);
const SCALE = 10n ** DECIMALS;

const AMOUNT_PATTERN = /^\d+(\.\d+)?$/;

/**
 * Convert a human USDC string into 6-decimal base units using integer math.
 *
 * Never use floating point for token amounts.
 *
 *   "1"      -> 1000000n
 *   "1.5"    -> 1500000n
 *   "5.00"   -> 5000000n
 *   "1.0000001" -> throws (more than 6 decimals)
 *   "0"      -> throws (non-positive)
 *   "-1"     -> throws (non-positive / invalid format)
 */
export function parseUsdcAmount(value: string): bigint {
  if (typeof value !== "string") {
    throw new UsdcAmountError("Amount must be a string");
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new UsdcAmountError("Amount is required");
  }
  if (!AMOUNT_PATTERN.test(trimmed)) {
    throw new UsdcAmountError(
      "Amount must be a positive decimal number, for example 5.00",
    );
  }

  const [wholePart, fractionPart = ""] = trimmed.split(".");
  if (fractionPart.length > ARC_USDC_DECIMALS) {
    throw new UsdcAmountError(
      `Amount cannot have more than ${ARC_USDC_DECIMALS} decimal places`,
    );
  }

  const paddedFraction = fractionPart.padEnd(ARC_USDC_DECIMALS, "0");
  const baseUnits = BigInt(wholePart) * SCALE + BigInt(paddedFraction || "0");

  if (baseUnits <= 0n) {
    throw new UsdcAmountError("Amount must be greater than zero");
  }

  return baseUnits;
}

/** Format base units back into a canonical decimal string, e.g. 5000000n -> "5.00". */
export function formatUsdcAmount(baseUnits: bigint): string {
  if (baseUnits < 0n) {
    throw new UsdcAmountError("Amount cannot be negative");
  }

  const whole = baseUnits / SCALE;
  const fraction = baseUnits % SCALE;
  return `${whole.toString()}.${fraction.toString().padStart(ARC_USDC_DECIMALS, "0")}`;
}

/** Human readable form with trailing zeros trimmed, e.g. 5000000n -> "5". */
export function formatUsdcAmountCompact(baseUnits: bigint): string {
  const formatted = formatUsdcAmount(baseUnits).replace(/\.?0+$/, "");
  return formatted.length > 0 ? formatted : "0";
}

/**
 * Validate an amount string for a payment link. Returns the parsed base units
 * on success and throws with a user-safe message on failure.
 */
export function validateUsdcAmount(value: string): bigint {
  const baseUnits = parseUsdcAmount(value);
  if (baseUnits > MAX_USDC_AMOUNT * SCALE) {
    throw new UsdcAmountError(
      `Amount cannot exceed ${MAX_USDC_AMOUNT.toString()} USDC`,
    );
  }
  return baseUnits;
}

/** Validate and normalise an EVM address. Returns a lower-cased address. */
export function validateAddress(value: string): Address {
  if (typeof value !== "string" || !isAddress(value, { strict: false })) {
    throw new Error("Recipient must be a valid EVM address");
  }
  return value.toLowerCase() as Address;
}

/**
 * Minimal ERC-20 surface needed to read USDC transfers. Kept small on purpose:
 * the MVP only needs `balanceOf`, `decimals`, `transfer` and the `Transfer`
 * event.
 */
export const erc20Abi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
] as const;
