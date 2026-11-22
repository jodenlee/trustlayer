// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {IJurorRegistry} from "./interfaces/IJurorRegistry.sol";

/// @notice Phase 2B juror custody and deterministic rotation. No voting, slashing or rewards.
/// @dev Local/test use; configure only a reviewed arbitration contract, never a test harness.
contract JurorRegistry is ReentrancyGuard, IJurorRegistry {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.UintSet;

    struct Juror {
        bool registered;
        uint256 depositedStake;
        uint256 lockedStake;
    }

    uint256 public constant MIN_STAKE = 100 * 10 ** 6;
    uint256 public constant STAKE_PER_DISPUTE = MIN_STAKE;
    uint256 public constant JURORS_PER_DISPUTE = 3;

    IERC20 public immutable stakingToken;
    address public immutable arbitrationConfigurator;
    address public arbitrationContract;
    uint256 public totalStaked;
    uint256 public totalLockedStake;

    mapping(address => Juror) public jurors;
    address[] public registeredJurors;
    mapping(address => EnumerableSet.UintSet) private _activeDisputes;
    mapping(uint256 => Assignment) private _assignments;

    // Circular eligible-only list. Zero next/previous means absent; a singleton links to itself.
    // Maintaining membership on every balance change bounds selection to at most five candidates.
    mapping(address => address) private _nextEligible;
    mapping(address => address) private _previousEligible;
    address public selectionCursor;
    uint256 public availableJurorCount;

    event ArbitrationContractConfigured(address indexed arbitrationContract);

    error Unauthorized();
    error InvalidInput();
    error InvalidState();
    error InsufficientAvailableStake();
    error InsufficientEligibleJurors();

    constructor(address token_) {
        if (token_.code.length == 0) revert InvalidInput();
        if (IERC20Metadata(token_).decimals() != 6) revert InvalidInput();
        stakingToken = IERC20(token_);
        arbitrationConfigurator = msg.sender;
    }

    modifier onlyArbitration() {
        if (msg.sender != arbitrationContract) revert Unauthorized();
        _;
    }

    /// @notice Same one-time deployer configuration pattern as TrustEscrow; no reset or replacement.
    function setArbitrationContract(address arbitration_) external nonReentrant {
        if (msg.sender != arbitrationConfigurator) revert Unauthorized();
        if (arbitrationContract != address(0)) revert InvalidState();
        if (arbitration_ == address(this) || arbitration_.code.length == 0) revert InvalidInput();
        arbitrationContract = arbitration_;
        emit ArbitrationContractConfigured(arbitration_);
    }

    /// @notice Registration does not confer eligibility until enough stake is deposited.
    function registerJuror() external override nonReentrant {
        Juror storage juror = jurors[msg.sender];
        if (juror.registered) revert InvalidState();
        juror.registered = true;
        registeredJurors.push(msg.sender);
        emit JurorRegistered(msg.sender);
    }

    function depositStake(uint256 amount) external override nonReentrant {
        Juror storage juror = jurors[msg.sender];
        if (!juror.registered) revert InvalidState();
        if (amount == 0) revert InvalidInput();
        uint256 beforeBalance = stakingToken.balanceOf(address(this));
        juror.depositedStake += amount;
        totalStaked += amount;
        _syncAvailability(msg.sender);
        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
        // As in escrow, fee-on-transfer tokens must not create unbacked liabilities.
        if (stakingToken.balanceOf(address(this)) != beforeBalance + amount) revert InvalidInput();
        emit StakeDeposited(msg.sender, amount);
    }

    /// @notice Withdraws only the caller's unlocked stake to the caller, even below the minimum.
    function withdrawStake(uint256 amount) external override nonReentrant {
        Juror storage juror = jurors[msg.sender];
        if (!juror.registered) revert InvalidState();
        if (amount == 0) revert InvalidInput();
        if (amount > availableStake(msg.sender)) revert InsufficientAvailableStake();
        juror.depositedStake -= amount;
        totalStaked -= amount;
        _syncAvailability(msg.sender);
        stakingToken.safeTransfer(msg.sender, amount);
        emit StakeWithdrawn(msg.sender, amount);
    }

    function registeredJurorCount() external view returns (uint256) {
        return registeredJurors.length;
    }

    function availableStake(address juror) public view override returns (uint256) {
        return jurors[juror].depositedStake - jurors[juror].lockedStake;
    }

    function isEligible(address juror) public view override returns (bool) {
        return jurors[juror].registered && availableStake(juror) >= MIN_STAKE;
    }

    function getJurorInfo(address juror) external view override returns (JurorInfo memory) {
        Juror storage j = jurors[juror];
        return JurorInfo(j.registered, j.depositedStake, j.lockedStake, availableStake(juror), _activeDisputes[juror].length());
    }

    /// @notice Eligible wallets in current rotation order, before excluding dispute participants.
    function getAvailableJurors() external view override returns (address[] memory result) {
        result = new address[](availableJurorCount);
        address cursor = selectionCursor;
        for (uint256 i; i < result.length; ++i) {
            result[i] = cursor;
            cursor = _nextEligible[cursor];
        }
    }

    function getActiveDisputes(address juror) external view override returns (uint256[] memory) {
        return _activeDisputes[juror].values();
    }

    function getAssignment(uint256 disputeId) external view override returns (Assignment memory) {
        return _assignments[disputeId];
    }

    function isAssigned(uint256 disputeId, address juror) external view override returns (bool) {
        Assignment storage assignment = _assignments[disputeId];
        if (assignment.state == AssignmentState.NONE) return false;
        for (uint256 i; i < JURORS_PER_DISPUTE; ++i) {
            if (assignment.jurors[i] == juror) return true;
        }
        return false;
    }

    function previewJurors(address client, address freelancer) external view override returns (address[3] memory selected) {
        (selected,) = _selectJurors(client, freelancer);
    }

    /// @notice Reserves exactly three distinct jurors and locks 100 mUSD from each, atomically.
    /// @dev Arbitration supplies the real parties and a globally unique dispute ID; no caller-supplied jury.
    function reserveJurors(uint256 disputeId, address client, address freelancer)
        external override onlyArbitration nonReentrant returns (address[3] memory selected)
    {
        Assignment storage assignment = _assignments[disputeId];
        if (assignment.state != AssignmentState.NONE) revert InvalidState();
        address nextCursor;
        (selected, nextCursor) = _selectJurors(client, freelancer);
        assignment.client = client;
        assignment.freelancer = freelancer;
        assignment.jurors = selected;
        assignment.state = AssignmentState.ACTIVE;
        // Set before removing newly unavailable jurors; removal advances this pointer if needed.
        selectionCursor = nextCursor;
        totalLockedStake += STAKE_PER_DISPUTE * JURORS_PER_DISPUTE;
        for (uint256 i; i < JURORS_PER_DISPUTE; ++i) {
            address juror = selected[i];
            jurors[juror].lockedStake += STAKE_PER_DISPUTE;
            _activeDisputes[juror].add(disputeId);
            _syncAvailability(juror);
            emit JurorAssigned(disputeId, juror);
            emit StakeLocked(disputeId, juror, STAKE_PER_DISPUTE);
        }
    }

    /// @notice Releases all three locks once. Does not transfer stake or implement a verdict.
    function releaseJurors(uint256 disputeId) external override onlyArbitration nonReentrant {
        Assignment storage assignment = _assignments[disputeId];
        if (assignment.state != AssignmentState.ACTIVE) revert InvalidState();
        assignment.state = AssignmentState.RELEASED;
        totalLockedStake -= STAKE_PER_DISPUTE * JURORS_PER_DISPUTE;
        for (uint256 i; i < JURORS_PER_DISPUTE; ++i) {
            address juror = assignment.jurors[i];
            jurors[juror].lockedStake -= STAKE_PER_DISPUTE;
            _activeDisputes[juror].remove(disputeId);
            _syncAvailability(juror);
            emit StakeUnlocked(disputeId, juror, STAKE_PER_DISPUTE);
        }
        emit AssignmentReleased(disputeId);
    }

    function _selectJurors(address client, address freelancer) private view returns (address[3] memory selected, address cursor) {
        if (client == address(0) || freelancer == address(0) || client == freelancer) revert InvalidInput();
        uint256 count = availableJurorCount;
        if (count < JURORS_PER_DISPUTE) revert InsufficientEligibleJurors();
        cursor = selectionCursor;
        uint256 found;
        // Each eligible entry is visited once. With only two exclusions, at most five visits suffice.
        for (uint256 visited; visited < count && found < JURORS_PER_DISPUTE; ++visited) {
            if (cursor != client && cursor != freelancer) selected[found++] = cursor;
            cursor = _nextEligible[cursor];
        }
        if (found != JURORS_PER_DISPUTE) revert InsufficientEligibleJurors();
    }

    /// @dev Eligible jurors retain relative order; new/re-eligible wallets append at the tail, before the cursor.
    function _syncAvailability(address juror) private {
        bool present = _nextEligible[juror] != address(0);
        if (isEligible(juror)) {
            if (present) return;
            address cursor = selectionCursor;
            if (cursor == address(0)) {
                _nextEligible[juror] = juror;
                _previousEligible[juror] = juror;
                selectionCursor = juror;
            } else {
                address tail = _previousEligible[cursor];
                _nextEligible[tail] = juror;
                _previousEligible[juror] = tail;
                _nextEligible[juror] = cursor;
                _previousEligible[cursor] = juror;
            }
            ++availableJurorCount;
        } else if (present) {
            address next = _nextEligible[juror];
            if (next == juror) {
                selectionCursor = address(0);
            } else {
                address previous = _previousEligible[juror];
                _nextEligible[previous] = next;
                _previousEligible[next] = previous;
                if (selectionCursor == juror) selectionCursor = next;
            }
            delete _nextEligible[juror];
            delete _previousEligible[juror];
            --availableJurorCount;
        }
    }
}
