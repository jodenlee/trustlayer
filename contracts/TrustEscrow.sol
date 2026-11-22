// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ITrustEscrowArbitration} from "./interfaces/ITrustEscrowArbitration.sol";
import {IProtocolTreasury} from "./interfaces/IProtocolTreasury.sol";
import {ERC165Checker} from "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";

/// @title TrustLayer TrustEscrow — Phase 1 escrow with Phase 2A arbitration hooks
/// @notice Local/test escrow; Phase 2D treasury intake is enabled for an ERC-165-compatible treasury.
/// @dev Settlement design follows the team solution specification: 6-decimal mUSD,
///      1% fee on freelancer gross, 1–5 sequential milestones.
contract TrustEscrow is ReentrancyGuard, ITrustEscrowArbitration {
    using SafeERC20 for IERC20;
    using ERC165Checker for address;

    struct Project {
        address client;
        address freelancer;
        bytes32 metadataHash;
        uint256 total;
        uint256 escrowRemaining;
        uint64 acceptBy;
        uint16 feeBps;
        uint8 currentMilestone;
        uint8 milestoneCount;
        ProjectState state;
    }
    struct Milestone {
        uint256 amount;
        uint64 dueAt;
        uint64 submittedAt;
        uint64 reviewEnd;
        bytes32 evidenceHash;
        MilestoneState state;
    }

    IERC20 public immutable paymentToken;
    address public immutable treasury;
    address public immutable arbitrationConfigurator;
    bool public immutable usesProtocolTreasury;
    uint256 public nextProjectId;
    uint256 public totalEscrowLiability;
    uint16 public constant SERVICE_FEE_BPS = 100; // 1%
    uint64 public constant ACCEPTANCE_WINDOW = 7 days;
    uint64 public constant DELIVERY_GRACE = 48 hours;
    uint64 public constant REVIEW_WINDOW = 72 hours;

    mapping(uint256 => Project) public projects;
    mapping(uint256 => mapping(uint256 => Milestone)) public milestones;
    address public arbitrationContract;

    event ProjectCreated(uint256 indexed projectId, address indexed client, address indexed freelancer, bytes32 metadataHash);
    event ProjectFunded(uint256 indexed projectId, uint256 amount);
    event ProjectAccepted(uint256 indexed projectId, address indexed freelancer);
    event MilestoneSubmitted(uint256 indexed projectId, uint256 indexed index, bytes32 evidenceHash, uint64 reviewEnd);
    event MilestoneSettled(uint256 indexed projectId, uint256 indexed index, uint256 grossAmount, uint256 freelancerGross, uint256 freelancerNet, uint256 clientRefund, uint256 serviceFee);
    event ProjectClosed(uint256 indexed projectId);
    event ArbitrationContractConfigured(address indexed arbitrationContract);

    error Unauthorized();
    error InvalidInput();
    error InvalidState();
    error NotReady();

    constructor(address token_, address treasury_) {
        if (token_ == address(0) || treasury_ == address(0)) revert InvalidInput();
        paymentToken = IERC20(token_);
        treasury = treasury_;
        arbitrationConfigurator = msg.sender;
        usesProtocolTreasury = treasury_.supportsInterface(type(IProtocolTreasury).interfaceId);
        if (usesProtocolTreasury && address(IProtocolTreasury(treasury_).paymentToken()) != token_) revert InvalidInput();
    }

    modifier onlyArbitration() {
        if (msg.sender != arbitrationContract) revert Unauthorized();
        _;
    }

    /// @notice The deployer may configure arbitration once; there is no replacement or reset path.
    /// @dev Deploy escrow first, then arbitration bound to this escrow, then configure it.
    function setArbitrationContract(address arbitration_) external {
        if (msg.sender != arbitrationConfigurator) revert Unauthorized();
        if (arbitrationContract != address(0)) revert InvalidState();
        if (arbitration_ == address(this) || arbitration_.code.length == 0) revert InvalidInput();
        arbitrationContract = arbitration_;
        emit ArbitrationContractConfigured(arbitration_);
    }

    function getDisputeContext(uint256 projectId, uint256 index) external view override returns (DisputeContext memory) {
        Project storage p = projects[projectId];
        if (projectId >= nextProjectId || index >= p.milestoneCount) revert InvalidInput();
        Milestone storage m = milestones[projectId][index];
        return DisputeContext(p.client, p.freelancer, m.amount, p.state, m.state, m.reviewEnd);
    }

    function freezeMilestone(uint256 projectId, uint256 index) external override onlyArbitration nonReentrant {
        Project storage p = projects[projectId];
        if (p.state != ProjectState.ACTIVE || index != p.currentMilestone) revert InvalidState();
        Milestone storage m = milestones[projectId][index];
        if (m.state != MilestoneState.SUBMITTED) revert InvalidState();
        // Complements releaseAfterReviewTimeout, which requires timestamp > reviewEnd.
        if (block.timestamp > m.reviewEnd) revert NotReady();
        m.state = MilestoneState.DISPUTED;
        emit MilestoneFrozen(projectId, index);
    }

    function settleDisputedMilestone(uint256 projectId, uint256 index, uint256 freelancerBps)
        external override onlyArbitration nonReentrant
    {
        if (freelancerBps > 10_000) revert InvalidInput();
        Project storage p = projects[projectId];
        if (p.state != ProjectState.ACTIVE || index != p.currentMilestone) revert InvalidState();
        if (milestones[projectId][index].state != MilestoneState.DISPUTED) revert InvalidState();
        _settle(projectId, index, freelancerBps);
        emit DisputedMilestoneSettled(projectId, index, freelancerBps);
    }

    function createProject(
        address freelancer,
        uint256[] calldata amounts,
        uint64[] calldata dueDates,
        bytes32 metadataHash
    ) external returns (uint256 projectId) {
        uint256 count = amounts.length;
        if (freelancer == address(0) || freelancer == msg.sender ||
            count == 0 || count > 5 || dueDates.length != count || metadataHash == bytes32(0)) revert InvalidInput();
        uint256 sum;
        uint64 previousDate = uint64(block.timestamp + ACCEPTANCE_WINDOW);
        projectId = nextProjectId++;
        for (uint256 i; i < count; ++i) {
            if (amounts[i] == 0 || dueDates[i] <= previousDate) revert InvalidInput();
            previousDate = dueDates[i];
            sum += amounts[i];
            milestones[projectId][i] = Milestone(amounts[i], dueDates[i], 0, 0, bytes32(0), MilestoneState.PENDING);
        }
        projects[projectId] = Project({
            client: msg.sender, freelancer: freelancer, metadataHash: metadataHash,
            total: sum, escrowRemaining: 0, acceptBy: uint64(block.timestamp + ACCEPTANCE_WINDOW),
            feeBps: SERVICE_FEE_BPS, currentMilestone: 0,
            milestoneCount: uint8(count), state: ProjectState.UNFUNDED
        });
        emit ProjectCreated(projectId, msg.sender, freelancer, metadataHash);
    }

    function fundProject(uint256 projectId) external nonReentrant {
        Project storage p = projects[projectId];
        if (p.client != msg.sender) revert Unauthorized();
        if (p.state != ProjectState.UNFUNDED) revert InvalidState();
        if (block.timestamp > p.acceptBy) revert NotReady();
        p.state = ProjectState.FUNDED;
        p.escrowRemaining = p.total;
        totalEscrowLiability += p.total;
        // Reject unsupported fee-on-transfer assets: the escrow must be backed exactly.
        uint256 beforeBalance = paymentToken.balanceOf(address(this));
        paymentToken.safeTransferFrom(msg.sender, address(this), p.total);
        if (paymentToken.balanceOf(address(this)) - beforeBalance != p.total) revert InvalidInput();
        emit ProjectFunded(projectId, p.total);
    }

    function acceptProject(uint256 projectId) external {
        Project storage p = projects[projectId];
        if (msg.sender != p.freelancer) revert Unauthorized();
        if (p.state != ProjectState.FUNDED) revert InvalidState();
        if (block.timestamp > p.acceptBy) revert NotReady();
        p.state = ProjectState.ACTIVE;
        emit ProjectAccepted(projectId, msg.sender);
    }

    function refundUnaccepted(uint256 projectId) external nonReentrant {
        Project storage p = projects[projectId];
        if (msg.sender != p.client) revert Unauthorized();
        if (p.state != ProjectState.FUNDED) revert InvalidState();
        if (block.timestamp <= p.acceptBy) revert NotReady();
        uint256 amount = p.escrowRemaining;
        p.escrowRemaining = 0;
        totalEscrowLiability -= amount;
        p.state = ProjectState.CLOSED;
        paymentToken.safeTransfer(p.client, amount);
        emit ProjectClosed(projectId);
    }

    function submitMilestone(uint256 projectId, uint256 index, bytes32 evidenceHash) external {
        Project storage p = projects[projectId];
        if (msg.sender != p.freelancer) revert Unauthorized();
        if (p.state != ProjectState.ACTIVE || index != p.currentMilestone) revert InvalidState();
        Milestone storage m = milestones[projectId][index];
        if (m.state != MilestoneState.PENDING || evidenceHash == bytes32(0)) revert InvalidInput();
        if (block.timestamp > m.dueAt + DELIVERY_GRACE) revert NotReady();
        m.state = MilestoneState.SUBMITTED;
        m.evidenceHash = evidenceHash;
        m.submittedAt = uint64(block.timestamp);
        m.reviewEnd = uint64(block.timestamp + REVIEW_WINDOW);
        emit MilestoneSubmitted(projectId, index, evidenceHash, m.reviewEnd);
    }

    function approveMilestone(uint256 projectId, uint256 index) external nonReentrant {
        Project storage p = projects[projectId];
        if (msg.sender != p.client) revert Unauthorized();
        _settleFreelancer(projectId, index);
    }

    function releaseAfterReviewTimeout(uint256 projectId, uint256 index) external nonReentrant {
        Project storage p = projects[projectId];
        if (msg.sender != p.freelancer) revert Unauthorized();
        if (p.state != ProjectState.ACTIVE || index != p.currentMilestone) revert InvalidState();
        Milestone storage m = milestones[projectId][index];
        if (m.state != MilestoneState.SUBMITTED) revert InvalidState();
        if (block.timestamp <= m.reviewEnd) revert NotReady();
        _settleFreelancer(projectId, index);
    }

    function refundMissedMilestone(uint256 projectId, uint256 index) external nonReentrant {
        Project storage p = projects[projectId];
        if (msg.sender != p.client) revert Unauthorized();
        if (p.state != ProjectState.ACTIVE || index != p.currentMilestone) revert InvalidState();
        Milestone storage m = milestones[projectId][index];
        if (m.state != MilestoneState.PENDING) revert InvalidState();
        if (block.timestamp <= m.dueAt + DELIVERY_GRACE) revert NotReady();
        _settle(projectId, index, 0);
    }

    function _settleFreelancer(uint256 projectId, uint256 index) private {
        Project storage p = projects[projectId];
        if (p.state != ProjectState.ACTIVE || index != p.currentMilestone) revert InvalidState();
        if (milestones[projectId][index].state != MilestoneState.SUBMITTED) revert InvalidState();
        _settle(projectId, index, 10_000);
    }

    function _settle(uint256 projectId, uint256 index, uint256 freelancerBps) private {
        Project storage p = projects[projectId];
        Milestone storage m = milestones[projectId][index];
        uint256 gross = m.amount;
        uint256 freelancerGross = Math.mulDiv(gross, freelancerBps, 10_000);
        uint256 clientRefund = gross - freelancerGross;
        uint256 serviceFee = Math.mulDiv(freelancerGross, p.feeBps, 10_000);
        uint256 freelancerNet = freelancerGross - serviceFee;
        m.state = MilestoneState.SETTLED;
        p.escrowRemaining -= gross;
        totalEscrowLiability -= gross;
        p.currentMilestone++;
        if (p.currentMilestone == p.milestoneCount) p.state = ProjectState.COMPLETED;
        if (clientRefund > 0) paymentToken.safeTransfer(p.client, clientRefund);
        if (freelancerNet > 0) paymentToken.safeTransfer(p.freelancer, freelancerNet);
        if (serviceFee > 0) {
            if (usesProtocolTreasury) {
                // Approve only this fee; the bound treasury pulls and verifies its exact receipt atomically.
                paymentToken.forceApprove(treasury, serviceFee);
                IProtocolTreasury(treasury).depositServiceFee(projectId, index, serviceFee);
            } else paymentToken.safeTransfer(treasury, serviceFee);
        }
        emit MilestoneSettled(projectId, index, gross, freelancerGross, freelancerNet, clientRefund, serviceFee);
    }
}
