import { createPublicClient, http, type PublicClient } from "viem";
import { arc } from "viem/chains";

import { getArcRpcUrl } from "./config";

/**
 * Server-side read-only client for Arc mainnet.
 *
 * This client is only used by the payment verifier. It never signs or sends
 * transactions and never holds a private key. Do not import it from client
 * components.
 */
export function createArcPublicClient(): PublicClient {
  return createPublicClient({
    chain: arc,
    transport: http(getArcRpcUrl(), {
      // Fail fast instead of hanging the request handler indefinitely.
      timeout: 15_000,
      retryCount: 2,
    }),
  });
}

let cachedClient: PublicClient | undefined;

/** Reuse a single public client across requests within a server process. */
export function getArcPublicClient(): PublicClient {
  if (!cachedClient) {
    cachedClient = createArcPublicClient();
  }
  return cachedClient;
}
