// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IProtocolTreasury} from "./interfaces/IProtocolTreasury.sol";
import {IDisputeArbitration} from "./interfaces/IDisputeArbitration.sol";
import {TrustEscrow} from "./TrustEscrow.sol";

interface ITreasuryArbitrationSource is IDisputeArbitration {
    function escrow() external view returns (address);
    function paymentToken() external view returns (IERC20);
}

/// @notice Protocol revenue vault. Juror rewards remain in arbitration; collateral remains in its original custody.
contract ProtocolTreasury is Ownable2Step, ReentrancyGuard, ERC165, IProtocolTreasury {
    using SafeERC20 for IERC20;

    uint256 public constant DISPUTE_PROTOCOL_FEE = 3 * 10 ** 6;
    IERC20 public immutable override paymentToken;
    address public override escrow;
    address public override arbitration;
    uint256 public availableRevenue;
    uint256 public totalServiceFeesReceived;
    uint256 public totalDisputeFeesReceived;
    uint256 public totalWithdrawn;
    mapping(uint256 => mapping(uint256 => bool)) public serviceFeeReceived;
    mapping(uint256 => bool) public disputeFeeReceived;

    event SourcesConfigured(address indexed escrow, address indexed arbitration);
    event ServiceFeeDeposited(uint256 indexed projectId, uint256 indexed milestoneIndex, uint256 amount);
    event DisputeFeeDeposited(uint256 indexed disputeId, uint256 amount);
    event TreasuryWithdrawal(address indexed owner, address indexed recipient, uint256 amount);

    error Unauthorized();
    error InvalidInput();
    error InvalidState();
    error InsufficientRevenue();

    constructor(address token_, address initialOwner) Ownable(initialOwner) {
        if (token_.code.length == 0) revert InvalidInput();
        if (IERC20Metadata(token_).decimals() != 6) revert InvalidInput();
        paymentToken = IERC20(token_);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC165, IERC165) returns (bool) {
        return interfaceId == type(IProtocolTreasury).interfaceId || super.supportsInterface(interfaceId);
    }

    /// @notice Bind the revenue sources once. Ownership transfer does not permit replacing these addresses.
    function configureSources(address escrow_, address arbitration_) external onlyOwner nonReentrant {
        if (escrow != address(0)) revert InvalidState();
        if (escrow_ == arbitration_ || escrow_.code.length == 0 || arbitration_.code.length == 0) revert InvalidInput();
        TrustEscrow source = TrustEscrow(escrow_);
        ITreasuryArbitrationSource disputeSource = ITreasuryArbitrationSource(arbitration_);
        if (address(source.paymentToken()) != address(paymentToken) || source.treasury() != address(this) ||
            !source.usesProtocolTreasury() || disputeSource.escrow() != escrow_ ||
            address(disputeSource.paymentToken()) != address(paymentToken)) revert InvalidInput();
        escrow = escrow_;
        arbitration = arbitration_;
        emit SourcesConfigured(escrow_, arbitration_);
    }

    function depositServiceFee(uint256 projectId, uint256 milestoneIndex, uint256 amount) external override nonReentrant {
        if (msg.sender != escrow) revert Unauthorized();
        if (amount == 0) revert InvalidInput();
        if (serviceFeeReceived[projectId][milestoneIndex]) revert InvalidState();
        serviceFeeReceived[projectId][milestoneIndex] = true;
        totalServiceFeesReceived += amount;
        _receiveRevenue(amount);
        emit ServiceFeeDeposited(projectId, milestoneIndex, amount);
    }

    function depositDisputeFee(uint256 disputeId) external override nonReentrant {
        if (msg.sender != arbitration) revert Unauthorized();
        if (disputeFeeReceived[disputeId]) revert InvalidState();
        if (ITreasuryArbitrationSource(arbitration).getDispute(disputeId).status != IDisputeArbitration.Status.FINALIZED) revert InvalidState();
        disputeFeeReceived[disputeId] = true;
        totalDisputeFeesReceived += DISPUTE_PROTOCOL_FEE;
        _receiveRevenue(DISPUTE_PROTOCOL_FEE);
        emit DisputeFeeDeposited(disputeId, DISPUTE_PROTOCOL_FEE);
    }

    function totalRevenueReceived() external view returns (uint256) {
        return totalServiceFeesReceived + totalDisputeFeesReceived;
    }

    function withdraw(address recipient, uint256 amount) external onlyOwner nonReentrant {
        if (recipient == address(0) || recipient == address(this) || amount == 0) revert InvalidInput();
        if (amount > availableRevenue) revert InsufficientRevenue();
        uint256 beforeBalance = paymentToken.balanceOf(address(this));
        uint256 beforeRecipient = paymentToken.balanceOf(recipient);
        availableRevenue -= amount;
        totalWithdrawn += amount;
        paymentToken.safeTransfer(recipient, amount);
        if (paymentToken.balanceOf(address(this)) != beforeBalance - amount ||
            paymentToken.balanceOf(recipient) != beforeRecipient + amount) revert InvalidInput();
        emit TreasuryWithdrawal(msg.sender, recipient, amount);
    }

    function _receiveRevenue(uint256 amount) private {
        uint256 beforeBalance = paymentToken.balanceOf(address(this));
        uint256 beforeSource = paymentToken.balanceOf(msg.sender);
        availableRevenue += amount;
        paymentToken.safeTransferFrom(msg.sender, address(this), amount);
        if (paymentToken.balanceOf(address(this)) != beforeBalance + amount ||
            paymentToken.balanceOf(msg.sender) != beforeSource - amount) revert InvalidInput();
    }
}
