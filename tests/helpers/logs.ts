import {
  encodeAbiParameters,
  encodeEventTopics,
  type Address,
  type Hex,
  type Log,
} from "viem";

import { erc20Abi } from "@/lib/arc/usdc";

const TX_HASH = `0x${"ab".repeat(32)}` as Hex;
const BLOCK_HASH = `0x${"cd".repeat(32)}` as Hex;

export function makeTransferLog(params: {
  token: string;
  from: string;
  to: string;
  value: bigint;
  logIndex?: number;
}): Log {
  const topics = encodeEventTopics({
    abi: erc20Abi,
    eventName: "Transfer",
    args: {
      from: params.from as Address,
      to: params.to as Address,
    },
  }) as Log["topics"];

  return {
    address: params.token as Address,
    topics,
    data: encodeAbiParameters([{ type: "uint256" }], [params.value]),
    blockHash: BLOCK_HASH,
    blockNumber: 100n,
    logIndex: params.logIndex ?? 0,
    removed: false,
    transactionHash: TX_HASH,
    transactionIndex: 0,
  };
}

export function makeReceipt(params: {
  status?: "success" | "reverted";
  to: string;
  logs: Log[];
  blockNumber?: bigint;
}) {
  return {
    status: params.status ?? "success",
    to: params.to as Address,
    logs: params.logs,
    blockNumber: params.blockNumber ?? 100n,
  };
}
