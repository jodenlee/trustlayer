import { LOCAL_CHAIN_ID } from "@trustlayer/contracts/metadata";
import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { createPublicClient, defineChain } from "viem";
import { LOCAL_RPC_URL } from "./deployment";

export const localChain = defineChain({
  id: LOCAL_CHAIN_ID,
  name: "Hardhat Local",
  nativeCurrency: { name: "Local Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [LOCAL_RPC_URL] } },
  testnet: true,
});
export const localClient = createPublicClient({
  chain: localChain,
  transport: http(LOCAL_RPC_URL, { retryCount: 0, timeout: 5000 }),
});
export function makeWalletConfig() {
  return createConfig({
    chains: [localChain],
    ssr: true,
    multiInjectedProviderDiscovery: true,
    connectors: [
      injected({ shimDisconnect: true, unstable_shimAsyncInject: 1500 }),
    ],
    transports: {
      [localChain.id]: http(LOCAL_RPC_URL, { retryCount: 0, timeout: 5000 }),
    },
  });
}
declare module "wagmi" {
  interface Register {
    config: ReturnType<typeof makeWalletConfig>;
  }
}
