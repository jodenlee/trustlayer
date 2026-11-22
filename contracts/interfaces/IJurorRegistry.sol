// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Staking and assignment boundary for a future DisputeArbitration contract.
interface IJurorRegistry {
    enum AssignmentState { NONE, ACTIVE, RELEASED }

    struct JurorInfo {
        bool registered;
        uint256 depositedStake;
        uint256 lockedStake;
        uint256 availableStake;
        uint256 activeAssignments;
    }

    struct Assignment {
        address client;
        address freelancer;
        address[3] jurors;
        AssignmentState state;
    }

    event JurorRegistered(address indexed juror);
    event StakeDeposited(address indexed juror, uint256 amount);
    event StakeWithdrawn(address indexed juror, uint256 amount);
    event JurorAssigned(uint256 indexed disputeId, address indexed juror);
    event StakeLocked(uint256 indexed disputeId, address indexed juror, uint256 amount);
    event StakeUnlocked(uint256 indexed disputeId, address indexed juror, uint256 amount);
    event AssignmentReleased(uint256 indexed disputeId);

    function registerJuror() external;
    function depositStake(uint256 amount) external;
    function withdrawStake(uint256 amount) external;

    /// @notice Eligibility for a new assignment requires at least 100 mUSD unlocked.
    function isEligible(address juror) external view returns (bool);
    function availableStake(address juror) external view returns (uint256);
    function getJurorInfo(address juror) external view returns (JurorInfo memory);
    function getAvailableJurors() external view returns (address[] memory);
    function getActiveDisputes(address juror) external view returns (uint256[] memory);
    function getAssignment(uint256 disputeId) external view returns (Assignment memory);

    /// @notice Historical membership remains true after release; dispute IDs cannot be reused.
    function isAssigned(uint256 disputeId, address juror) external view returns (bool);

    /// @notice Predictable rotation, not randomness. Reverts if fewer than three candidates qualify.
    function previewJurors(address client, address freelancer) external view returns (address[3] memory);
    function reserveJurors(uint256 disputeId, address client, address freelancer) external returns (address[3] memory);

    /// @notice Arbitration calls this once after finalization, including any fallback outcome.
    function releaseJurors(uint256 disputeId) external;
}
