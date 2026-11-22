// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {JurorRegistry} from "../JurorRegistry.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev TEST ONLY: forwards to real registry custody and can force a release failure after escrow pays.
contract DisputeRegistryHarness {
    JurorRegistry public immutable target;
    IERC20 public immutable stakingToken;
    address public arbitrationContract;
    bool public failRelease;

    error ForcedReleaseFailure();
    error Unauthorized();

    constructor(address registry_) {
        target = JurorRegistry(registry_);
        stakingToken = target.stakingToken();
    }

    function setArbitrationContract(address arbitration_) external {
        arbitrationContract = arbitration_;
    }

    function setFailRelease(bool fail_) external {
        failRelease = fail_;
    }

    function reserveJurors(uint256 disputeId, address client, address freelancer) external returns (address[3] memory) {
        if (msg.sender != arbitrationContract) revert Unauthorized();
        return target.reserveJurors(disputeId, client, freelancer);
    }

    function releaseJurors(uint256 disputeId) external {
        if (msg.sender != arbitrationContract) revert Unauthorized();
        if (failRelease) revert ForcedReleaseFailure();
        target.releaseJurors(disputeId);
    }
}
