// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IJurorRegistry} from "../interfaces/IJurorRegistry.sol";

/// @dev TEST ONLY: unrestricted forwarding for registry authorization tests; never deploy as arbitration.
contract JurorArbitrationHarness {
    IJurorRegistry public immutable registry;

    constructor(address registry_) {
        registry = IJurorRegistry(registry_);
    }

    function reserve(uint256 disputeId, address client, address freelancer) external returns (address[3] memory) {
        return registry.reserveJurors(disputeId, client, freelancer);
    }

    function release(uint256 disputeId) external {
        registry.releaseJurors(disputeId);
    }
}
