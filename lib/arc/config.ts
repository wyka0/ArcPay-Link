/**
 * Arc mainnet configuration.
 *
 * Every Arc-specific constant lives here so the rest of the codebase never
 * hard-codes a chain id, RPC URL or token address. Values below were verified
 * against the official Arc documentation:
 *
 *   - https://docs.arc.io/arc/references/connect-to-arc
 *   - https://docs.arc.io/arc/references/contract-addresses
 *
 * Verified on 2026-09-19:
 *   chainId      = 5042
 *   rpcUrl       = https://rpc.mainnet.arc.io
 *   explorerUrl  = https://explorer.arc.io
 *   native USDC  = 18 decimals (gas token)
 *   USDC ERC-20  = 0x3600000000000000000000000000000000000000 (6 decimals)
 *
 * The USDC ERC-20 interface is what payment verification reads. It uses 6
 * decimals, which is different from the 18 decimals of the native gas token.
 */

export const ARC_MAINNET_CHAIN_ID = 5042 as const;

export const ARC_MAINNET_NAME = "Arc" as const;

export const ARC_MAINNET_RPC_URL = "https://rpc.mainnet.arc.io" as const;

export const ARC_MAINNET_EXPLORER_URL = "https://explorer.arc.io" as const;

export const ARC_USDC_ADDRESS =
  "0x3600000000000000000000000000000000000000" as const;

/** Decimals of the USDC ERC-20 interface used for transfers. */
export const ARC_USDC_DECIMALS = 6 as const;

/** Decimals of the native USDC gas token. Never mix with ARC_USDC_DECIMALS. */
export const ARC_NATIVE_USDC_DECIMALS = 18 as const;

/**
 * Tolerance (in seconds) allowed when comparing an on-chain transfer's block
 * timestamp against a payment's `createdAt`.
 *
 * A transfer must occur at or after payment creation. Because a wallet/clock or
 * a provider may be marginally ahead of the server clock, a small amount of
 * backdating is tolerated. This is deliberately small: it exists only to absorb
 * clock skew, not to widen the acceptance window.
 */
export const PAYMENT_TRANSFER_TOLERANCE_SECONDS = 120 as const;

export const ARC_MAINNET = {
  chainId: ARC_MAINNET_CHAIN_ID,
  name: ARC_MAINNET_NAME,
  rpcUrl: ARC_MAINNET_RPC_URL,
  explorerUrl: ARC_MAINNET_EXPLORER_URL,
  nativeCurrency: {
    name: "USDC",
    symbol: "USDC",
    decimals: ARC_NATIVE_USDC_DECIMALS,
  },
  usdc: {
    address: ARC_USDC_ADDRESS,
    decimals: ARC_USDC_DECIMALS,
  },
} as const;

/**
 * Resolve the RPC endpoint. Defaults to the verified public mainnet endpoint;
 * `ARC_RPC_URL` may override it (for example a dedicated provider). Only
 * server-side code may call this.
 */
export function getArcRpcUrl(): string {
  const fromEnv = process.env.ARC_RPC_URL?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : ARC_MAINNET_RPC_URL;
}

/**
 * Resolve the expected USDC contract address. Defaults to the verified Arc
 * mainnet USDC interface. The value is normalised to lower case for stable
 * comparisons during verification.
 */
export function getArcUsdcAddress(): `0x${string}` {
  const fromEnv = process.env.ARC_USDC_ADDRESS?.trim();
  const value = fromEnv && fromEnv.length > 0 ? fromEnv : ARC_USDC_ADDRESS;
  return value.toLowerCase() as `0x${string}`;
}

/** Public, browser-safe chain metadata used to add/switch the wallet network. */
export function getArcWalletChainParams() {
  return {
    chainId: `0x${ARC_MAINNET_CHAIN_ID.toString(16)}`,
    chainName: ARC_MAINNET_NAME,
    nativeCurrency: ARC_MAINNET.nativeCurrency,
    rpcUrls: [ARC_MAINNET_RPC_URL],
    blockExplorerUrls: [ARC_MAINNET_EXPLORER_URL],
  };
}
