// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ITrustEscrowArbitration} from "../interfaces/ITrustEscrowArbitration.sol";

/// @dev TEST ONLY: unrestricted forwarding to exercise escrow contract-caller authorization.
///      No dispute decisions are implemented here. Never configure this on a live deployment.
contract ArbitrationHarness {
    ITrustEscrowArbitration public immutable escrow;

    constructor(address escrow_) {
        escrow = ITrustEscrowArbitration(escrow_);
    }

    function freeze(uint256 projectId, uint256 index) external {
        escrow.freezeMilestone(projectId, index);
    }

    function settle(uint256 projectId, uint256 index, uint256 freelancerBps) external {
        escrow.settleDisputedMilestone(projectId, index, freelancerBps);
    }
}
