import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

// Fresh stack: earlier modules bind escrow's immutable treasury to a demo wallet.
export default buildModule("TrustLayerPhase2D", (m) => {
  const deployer = m.getAccount(0);
  const token = m.contract("MockUSD", [deployer]);
  const treasury = m.contract("ProtocolTreasury", [token, deployer]);
  const escrow = m.contract("TrustEscrow", [token, treasury]);
  const registry = m.contract("JurorRegistry", [token]);
  const arbitration = m.contract("DisputeArbitration", [escrow, registry]);
  const sources = m.call(treasury, "configureSources", [escrow, arbitration], { from: deployer });
  m.call(arbitration, "setProtocolTreasury", [treasury], { from: deployer, after: [sources] });
  m.call(escrow, "setArbitrationContract", [arbitration], { id: "ConfigureEscrowArbitration", from: deployer });
  m.call(registry, "setArbitrationContract", [arbitration], { id: "ConfigureRegistryArbitration", from: deployer });
  return { token, treasury, escrow, registry, arbitration };
});
