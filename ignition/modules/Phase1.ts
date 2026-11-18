import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("TrustLayerPhase1", (m) => {
  const deployer = m.getAccount(0);
  const token = m.contract("MockUSD", [deployer]);
  // Demo treasury is deployer wallet in Phase 1 only. Replace with ProtocolTreasury in Phase 2.
  const escrow = m.contract("TrustEscrow", [token, deployer]);
  return { token, escrow };
});
