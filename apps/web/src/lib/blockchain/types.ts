import type { getContracts, LocalDeployment } from "@trustlayer/contracts";
export type { ContractName, LocalDeployment } from "@trustlayer/contracts";
export type ContractClients = ReturnType<typeof getContracts>;
/** Future adapters must validate provenance before exposing any write path. */
export interface VerifiedConnection {
  deployment: LocalDeployment;
  contracts: ContractClients;
  account: `0x${string}`;
}
