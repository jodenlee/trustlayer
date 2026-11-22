// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Escrow boundary used by a separately deployed arbitration contract.
interface ITrustEscrowArbitration {
    // Preserve the Phase 1 enum order and public getter ABI.
    enum ProjectState { UNFUNDED, FUNDED, ACTIVE, COMPLETED, CLOSED }
    enum MilestoneState { PENDING, SUBMITTED, DISPUTED, SETTLED }

    struct DisputeContext {
        address client;
        address freelancer;
        uint256 amount;
        ProjectState projectState;
        MilestoneState milestoneState;
        uint64 reviewEnd;
    }

    event MilestoneFrozen(uint256 indexed projectId, uint256 indexed index);
    event DisputedMilestoneSettled(uint256 indexed projectId, uint256 indexed index, uint256 freelancerBps);

    /// @notice Reverts for a nonexistent project or milestone.
    function getDisputeContext(uint256 projectId, uint256 index) external view returns (DisputeContext memory);

    /// @notice Only arbitration may freeze the current submitted milestone, through reviewEnd inclusive.
    function freezeMilestone(uint256 projectId, uint256 index) external;

    /// @notice Only arbitration may settle a frozen milestone. Allocation is 0-10,000 inclusive.
    /// @dev Client receives the remainder; the 1% service fee applies to freelancer gross only.
    function settleDisputedMilestone(uint256 projectId, uint256 index, uint256 freelancerBps) external;
}
