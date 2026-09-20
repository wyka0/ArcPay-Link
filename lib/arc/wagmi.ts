import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { arc } from "viem/chains";

import { getArcRpcUrl } from "./config";

/**
 * wagmi configuration for Arc mainnet.
 *
 * Only the injected connector is configured, so no WalletConnect project id or
 * other third-party credential is required. Arc is the single supported chain:
 * the UI blocks payment on any other chain rather than switching silently.
 *
 * This module is imported by the client provider only.
 */
export function createArcWagmiConfig() {
  return createConfig({
    chains: [arc],
    connectors: [injected({ shimDisconnect: true })],
    transports: {
      [arc.id]: http(getArcRpcUrl()),
    },
    ssr: true,
  });
}

export type ArcWagmiConfig = ReturnType<typeof createArcWagmiConfig>;

let cachedConfig: ArcWagmiConfig | undefined;

export function getArcWagmiConfig(): ArcWagmiConfig {
  if (!cachedConfig) {
    cachedConfig = createArcWagmiConfig();
  }
  return cachedConfig;
}
