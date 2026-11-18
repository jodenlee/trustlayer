import { LOCAL_CHAIN_ID, TOKEN_DECIMALS } from "@trustlayer/contracts/metadata";
/** Metadata only. No provider, RPC, address manifest or wallet is instantiated. */
export const networkPreview = {
  name: "Hardhat Local",
  chainId: LOCAL_CHAIN_ID,
  token: "mUSD",
  decimals: TOKEN_DECIMALS,
  connected: false,
} as const;
