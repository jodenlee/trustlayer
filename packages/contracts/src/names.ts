export const CONTRACT_NAMES = ["MockUSD", "TrustEscrow", "JurorRegistry", "DisputeArbitration", "ProtocolTreasury"] as const;
export type ContractName = (typeof CONTRACT_NAMES)[number];
export const LOCAL_CHAIN_ID = 31337 as const;
export const TOKEN_DECIMALS = 6 as const;
