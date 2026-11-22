// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {TrustEscrow} from "./TrustEscrow.sol";
import {JurorRegistry} from "./JurorRegistry.sol";
import {ITrustEscrowArbitration} from "./interfaces/ITrustEscrowArbitration.sol";
import {IDisputeArbitration} from "./interfaces/IDisputeArbitration.sol";
import {IJurorRewards} from "./interfaces/IJurorRewards.sol";
import {IProtocolTreasury} from "./interfaces/IProtocolTreasury.sol";
import {ERC165Checker} from "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";

/// @notice Phase 2C arbitration: a 12-hour response window, 24-hour voting and majority/fallback settlement.
/// @dev Local/test use. One-time Phase 2D configuration enables treasury intake and assigned-juror pull rewards.
contract DisputeArbitration is ReentrancyGuard, IDisputeArbitration, IJurorRewards {
    using SafeERC20 for IERC20;
    using ERC165Checker for address;

    uint256 public constant DISPUTE_FEE = 15 * 10 ** 6;
    uint256 public constant JUROR_FEE_PORTION = 12 * 10 ** 6;
    uint256 public constant PROTOCOL_FEE_PORTION = 3 * 10 ** 6;
    uint256 public constant JUROR_REWARD = 4 * 10 ** 6;
    uint64 public constant RESPONSE_WINDOW = 12 hours;
    uint64 public constant VOTING_WINDOW = 24 hours;

    TrustEscrow public immutable escrow;
    JurorRegistry public immutable registry;
    IERC20 public immutable paymentToken;
    uint256 public nextDisputeId;
    uint256 public totalDisputeFeesHeld;
    uint256 public pendingJurorFees;
    uint256 public pendingProtocolFees;
    address public immutable treasuryConfigurator;
    IProtocolTreasury public protocolTreasury;
    uint256 public reservedJurorRewards;
    uint256 public totalJurorRewardsReserved;
    uint256 public totalJurorRewardsClaimed;
    uint256 public totalProtocolFeesTransferred;
    mapping(uint256 => bool) public rewardsReserved;
    mapping(uint256 => uint256) public rewardsClaimedForDispute;
    mapping(uint256 => mapping(address => bool)) public rewardClaimed;

    event ProtocolTreasuryConfigured(address indexed treasury);

    mapping(uint256 => Dispute) private _disputes;
    // Encoded as dispute ID + 1, since dispute ID zero is valid.
    mapping(uint256 => mapping(uint256 => uint256)) private _milestoneDisputes;
    mapping(uint256 => mapping(address => Vote)) public votes;

    error Unauthorized();
    error InvalidInput();
    error InvalidState();
    error NotReady();
    error InvalidConfiguration();

    constructor(address escrow_, address registry_) {
        if (escrow_ == registry_ || escrow_.code.length == 0 || registry_.code.length == 0) revert InvalidInput();
        escrow = TrustEscrow(escrow_);
        registry = JurorRegistry(registry_);
        IERC20 token = escrow.paymentToken();
        if (address(token) != address(registry.stakingToken())) revert InvalidConfiguration();
        // Deployment must precede both one-time authorizations; configuration is not performed by this constructor.
        if (escrow.arbitrationContract() != address(0) || registry.arbitrationContract() != address(0)) revert InvalidConfiguration();
        paymentToken = token;
        treasuryConfigurator = msg.sender;
    }

    /// @notice Explicit Phase 2D opt-in before the first dispute, never a migration/sweep of retained Phase 2C fees.
    function setProtocolTreasury(address treasury_) external nonReentrant {
        if (msg.sender != treasuryConfigurator) revert Unauthorized();
        if (address(protocolTreasury) != address(0) || nextDisputeId != 0) revert InvalidState();
        if (!treasury_.supportsInterface(type(IProtocolTreasury).interfaceId)) revert InvalidInput();
        IProtocolTreasury target = IProtocolTreasury(treasury_);
        if (address(target.paymentToken()) != address(paymentToken) || target.escrow() != address(escrow) ||
            target.arbitration() != address(this) || escrow.treasury() != treasury_ || !escrow.usesProtocolTreasury()) revert InvalidConfiguration();
        protocolTreasury = target;
        emit ProtocolTreasuryConfigured(treasury_);
    }

    function isConfigured() public view returns (bool) {
        return escrow.arbitrationContract() == address(this) && registry.arbitrationContract() == address(this) &&
            (!escrow.usesProtocolTreasury() || address(protocolTreasury) != address(0));
    }

    /// @notice The opening participant pays the 15 mUSD fee from their own approved wallet balance.
    function openDispute(uint256 projectId, uint256 milestoneIndex, bytes32 evidenceHash)
        external override nonReentrant returns (uint256 disputeId)
    {
        if (!isConfigured()) revert InvalidConfiguration();
        if (_milestoneDisputes[projectId][milestoneIndex] != 0) revert InvalidState();
        if (evidenceHash == bytes32(0)) revert InvalidInput();
        ITrustEscrowArbitration.DisputeContext memory context = escrow.getDisputeContext(projectId, milestoneIndex);
        if (msg.sender != context.client && msg.sender != context.freelancer) revert Unauthorized();
        if (context.projectState != ITrustEscrowArbitration.ProjectState.ACTIVE ||
            context.milestoneState != ITrustEscrowArbitration.MilestoneState.SUBMITTED) revert InvalidState();
        if (block.timestamp > context.reviewEnd) revert NotReady();

        disputeId = nextDisputeId++;
        _milestoneDisputes[projectId][milestoneIndex] = disputeId + 1;
        Dispute storage dispute = _disputes[disputeId];
        dispute.projectId = projectId;
        dispute.milestoneIndex = milestoneIndex;
        dispute.milestoneAmount = context.amount;
        dispute.client = context.client;
        dispute.freelancer = context.freelancer;
        dispute.opener = msg.sender;
        dispute.evidenceHash = evidenceHash;
        dispute.openedAt = uint64(block.timestamp);
        dispute.responseDeadline = uint64(block.timestamp + RESPONSE_WINDOW);
        dispute.votingDeadline = uint64(block.timestamp + RESPONSE_WINDOW + VOTING_WINDOW);
        dispute.status = Status.OPEN;
        totalDisputeFeesHeld += DISPUTE_FEE;
        pendingJurorFees += JUROR_FEE_PORTION;
        pendingProtocolFees += PROTOCOL_FEE_PORTION;

        uint256 beforeBalance = paymentToken.balanceOf(address(this));
        paymentToken.safeTransferFrom(msg.sender, address(this), DISPUTE_FEE);
        if (paymentToken.balanceOf(address(this)) != beforeBalance + DISPUTE_FEE) revert InvalidInput();
        escrow.freezeMilestone(projectId, milestoneIndex);
        dispute.jurors = registry.reserveJurors(disputeId, context.client, context.freelancer);
        emit DisputeFeeCollected(disputeId, msg.sender, DISPUTE_FEE);
        emit DisputeOpened(disputeId, projectId, milestoneIndex, msg.sender, evidenceHash, dispute.responseDeadline, dispute.votingDeadline);
    }

    /// @notice The other participant may record one response hash before voting starts; silence never blocks finalization.
    function respondToDispute(uint256 disputeId, bytes32 evidenceHash) external override nonReentrant {
        Dispute storage dispute = _openDispute(disputeId);
        if ((msg.sender != dispute.client && msg.sender != dispute.freelancer) || msg.sender == dispute.opener) revert Unauthorized();
        if (block.timestamp >= dispute.responseDeadline) revert NotReady();
        if (evidenceHash == bytes32(0)) revert InvalidInput();
        if (dispute.responseHash != bytes32(0)) revert InvalidState();
        dispute.responseHash = evidenceHash;
        emit DisputeResponded(disputeId, msg.sender, evidenceHash);
    }

    function castVote(uint256 disputeId, Vote vote) external override nonReentrant {
        Dispute storage dispute = _openDispute(disputeId);
        if (msg.sender == dispute.client || msg.sender == dispute.freelancer) revert Unauthorized();
        bool assigned;
        for (uint256 i; i < 3; ++i) {
            if (dispute.jurors[i] == msg.sender) assigned = true;
        }
        if (!assigned) revert Unauthorized();
        // Voting includes both boundary timestamps; finalization requires strictly later than votingDeadline.
        if (block.timestamp < dispute.responseDeadline || block.timestamp > dispute.votingDeadline) revert NotReady();
        if (vote == Vote.NONE) revert InvalidInput();
        if (votes[disputeId][msg.sender] != Vote.NONE) revert InvalidState();
        votes[disputeId][msg.sender] = vote;
        if (vote == Vote.FREELANCER_WINS) ++dispute.freelancerVotes;
        else if (vote == Vote.CLIENT_WINS) ++dispute.clientVotes;
        else ++dispute.splitVotes;
        emit VoteCast(disputeId, msg.sender, vote);
    }

    function finalizeDispute(uint256 disputeId) external override nonReentrant {
        Dispute storage dispute = _openDispute(disputeId);
        if (block.timestamp <= dispute.votingDeadline) revert NotReady();
        (Vote ruling, uint16 freelancerBps, bool fallbackApplied) = _verdict(dispute);
        dispute.status = Status.FINALIZED;
        dispute.ruling = ruling;
        dispute.freelancerBps = freelancerBps;
        dispute.fallbackApplied = fallbackApplied;
        dispute.finalizedAt = uint64(block.timestamp);
        bool distributeFees = address(protocolTreasury) != address(0);
        if (distributeFees) {
            rewardsReserved[disputeId] = true;
            pendingJurorFees -= JUROR_FEE_PORTION;
            pendingProtocolFees -= PROTOCOL_FEE_PORTION;
            reservedJurorRewards += JUROR_FEE_PORTION;
            totalJurorRewardsReserved += JUROR_FEE_PORTION;
            totalProtocolFeesTransferred += PROTOCOL_FEE_PORTION;
            totalDisputeFeesHeld -= PROTOCOL_FEE_PORTION;
        }
        // A failure in either contract rolls back this status, all payouts, locks and logs together.
        escrow.settleDisputedMilestone(dispute.projectId, dispute.milestoneIndex, freelancerBps);
        registry.releaseJurors(disputeId);
        if (distributeFees) {
            paymentToken.forceApprove(address(protocolTreasury), PROTOCOL_FEE_PORTION);
            protocolTreasury.depositDisputeFee(disputeId);
            emit JurorRewardsReserved(disputeId, JUROR_FEE_PORTION);
            emit ProtocolFeeDeposited(disputeId, address(protocolTreasury), PROTOCOL_FEE_PORTION);
        }
        emit VerdictReached(disputeId, ruling, fallbackApplied, dispute.freelancerVotes, dispute.clientVotes, dispute.splitVotes);
        emit DisputeFinalized(disputeId, dispute.projectId, dispute.milestoneIndex, freelancerBps, dispute.milestoneAmount, dispute.finalizedAt);
    }

    function claimableReward(uint256 disputeId, address juror) public view override returns (uint256) {
        Dispute storage dispute = _disputes[disputeId];
        if (!rewardsReserved[disputeId] || dispute.status != Status.FINALIZED || rewardClaimed[disputeId][juror]) return 0;
        for (uint256 i; i < 3; ++i) {
            if (dispute.jurors[i] == juror) return JUROR_REWARD;
        }
        return 0;
    }

    /// @notice Claim only the caller's fixed reward to the caller; no administrator or arbitrary recipient path.
    function claimJurorReward(uint256 disputeId) external override nonReentrant {
        if (!rewardsReserved[disputeId] || _disputes[disputeId].status != Status.FINALIZED) revert InvalidState();
        if (rewardClaimed[disputeId][msg.sender]) revert InvalidState();
        if (claimableReward(disputeId, msg.sender) == 0) revert Unauthorized();
        uint256 claimed = rewardsClaimedForDispute[disputeId] + JUROR_REWARD;
        if (claimed > JUROR_FEE_PORTION) revert InvalidState();
        uint256 beforeBalance = paymentToken.balanceOf(address(this));
        uint256 beforeJuror = paymentToken.balanceOf(msg.sender);
        rewardsClaimedForDispute[disputeId] = claimed;
        rewardClaimed[disputeId][msg.sender] = true;
        reservedJurorRewards -= JUROR_REWARD;
        totalJurorRewardsClaimed += JUROR_REWARD;
        totalDisputeFeesHeld -= JUROR_REWARD;
        paymentToken.safeTransfer(msg.sender, JUROR_REWARD);
        if (paymentToken.balanceOf(address(this)) != beforeBalance - JUROR_REWARD ||
            paymentToken.balanceOf(msg.sender) != beforeJuror + JUROR_REWARD) revert InvalidInput();
        emit JurorRewardClaimed(disputeId, msg.sender, JUROR_REWARD);
    }

    function getDispute(uint256 disputeId) external view override returns (Dispute memory) {
        if (_disputes[disputeId].status == Status.NONE) revert InvalidInput();
        return _disputes[disputeId];
    }

    function getMilestoneDispute(uint256 projectId, uint256 milestoneIndex) external view override returns (bool exists, uint256 disputeId) {
        uint256 encoded = _milestoneDisputes[projectId][milestoneIndex];
        return encoded == 0 ? (false, 0) : (true, encoded - 1);
    }

    /// @notice Returns a binding ruling only after voting ends, or the already finalized ruling.
    function getVerdict(uint256 disputeId) external view override returns (Vote ruling, uint16 freelancerBps, bool fallbackApplied) {
        Dispute storage dispute = _disputes[disputeId];
        if (dispute.status == Status.NONE) revert InvalidInput();
        if (block.timestamp <= dispute.votingDeadline) revert NotReady();
        return _verdict(dispute);
    }

    function _openDispute(uint256 disputeId) private view returns (Dispute storage dispute) {
        dispute = _disputes[disputeId];
        if (dispute.status != Status.OPEN) revert InvalidState();
    }

    function _verdict(Dispute storage dispute) private view returns (Vote ruling, uint16 freelancerBps, bool fallbackApplied) {
        if (dispute.freelancerVotes >= 2) return (Vote.FREELANCER_WINS, 10_000, false);
        if (dispute.clientVotes >= 2) return (Vote.CLIENT_WINS, 0, false);
        if (dispute.splitVotes >= 2) return (Vote.SPLIT, 5_000, false);
        // Zero votes, one vote, two different votes, or three different votes all lack a two-vote majority.
        return (Vote.SPLIT, 5_000, true);
    }
}
