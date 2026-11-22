// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Participant dispute creation, juror votes and permissionless on-chain finalization.
interface IDisputeArbitration {
    enum Status { NONE, OPEN, FINALIZED }
    enum Vote { NONE, FREELANCER_WINS, CLIENT_WINS, SPLIT }

    struct Dispute {
        uint256 projectId;
        uint256 milestoneIndex;
        uint256 milestoneAmount;
        address client;
        address freelancer;
        address opener;
        address[3] jurors;
        bytes32 evidenceHash;
        bytes32 responseHash;
        uint64 openedAt;
        uint64 responseDeadline;
        uint64 votingDeadline;
        uint64 finalizedAt;
        uint8 freelancerVotes;
        uint8 clientVotes;
        uint8 splitVotes;
        Status status;
        Vote ruling;
        bool fallbackApplied;
        uint16 freelancerBps;
    }

    event DisputeOpened(uint256 indexed disputeId, uint256 indexed projectId, uint256 indexed milestoneIndex, address opener, bytes32 evidenceHash, uint64 responseDeadline, uint64 votingDeadline);
    event DisputeFeeCollected(uint256 indexed disputeId, address indexed payer, uint256 amount);
    event DisputeResponded(uint256 indexed disputeId, address indexed responder, bytes32 evidenceHash);
    event VoteCast(uint256 indexed disputeId, address indexed juror, Vote vote);
    event VerdictReached(uint256 indexed disputeId, Vote ruling, bool fallbackApplied, uint8 freelancerVotes, uint8 clientVotes, uint8 splitVotes);
    event DisputeFinalized(uint256 indexed disputeId, uint256 indexed projectId, uint256 indexed milestoneIndex, uint256 freelancerBps, uint256 milestoneAmount, uint64 finalizedAt);

    function openDispute(uint256 projectId, uint256 milestoneIndex, bytes32 evidenceHash) external returns (uint256 disputeId);
    function respondToDispute(uint256 disputeId, bytes32 evidenceHash) external;
    function castVote(uint256 disputeId, Vote vote) external;
    function finalizeDispute(uint256 disputeId) external;
    function getDispute(uint256 disputeId) external view returns (Dispute memory);
    function getMilestoneDispute(uint256 projectId, uint256 milestoneIndex) external view returns (bool exists, uint256 disputeId);
    function getVerdict(uint256 disputeId) external view returns (Vote ruling, uint16 freelancerBps, bool fallbackApplied);
}
