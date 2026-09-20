import { encodeFunctionData, type Address, type Hex } from "viem";

import {
  ARC_MAINNET_CHAIN_ID,
  ARC_MAINNET_EXPLORER_URL,
  getArcUsdcAddress,
} from "./config";
import { erc20Abi } from "./usdc";

export interface UsdcTransferRequest {
  to: Address;
  data: Hex;
  value: bigint;
}

/**
 * Build the unsigned USDC.transfer(recipient, amount) call a payer wallet must
 * submit. This only encodes calldata; no key is involved and nothing is sent
 * here.
 */
export function buildUsdcTransferRequest(params: {
  recipient: Address;
  amountBaseUnits: bigint;
}): UsdcTransferRequest {
  return {
    to: getArcUsdcAddress(),
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [params.recipient, params.amountBaseUnits],
    }),
    value: 0n,
  };
}

/** True only for the Arc mainnet chain id the app was built for. */
export function isArcMainnet(chainId: number | null | undefined): boolean {
  return chainId === ARC_MAINNET_CHAIN_ID;
}

/** Block explorer link for a transaction hash. */
export function explorerTxUrl(txHash: string): string {
  return `${ARC_MAINNET_EXPLORER_URL}/tx/${txHash}`;
}

/** Block explorer link for an address. */
export function explorerAddressUrl(address: string): string {
  return `${ARC_MAINNET_EXPLORER_URL}/address/${address}`;
}
