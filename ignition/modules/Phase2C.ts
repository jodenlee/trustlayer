import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import phase2B from "./Phase2B.js";

export default buildModule("TrustLayerPhase2C", (m) => {
  const { token, escrow, registry } = m.useModule(phase2B);
  const arbitration = m.contract("DisputeArbitration", [escrow, registry]);
  const deployer = m.getAccount(0);
  m.call(escrow, "setArbitrationContract", [arbitration], { id: "ConfigureEscrowArbitration", from: deployer });
  m.call(registry, "setArbitrationContract", [arbitration], { id: "ConfigureRegistryArbitration", from: deployer });
  return { token, escrow, registry, arbitration };
});
