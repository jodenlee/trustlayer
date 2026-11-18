// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @notice Authorized fee intake only; treasury never has authority over principal, stakes or rewards.
interface IProtocolTreasury is IERC165 {
    function paymentToken() external view returns (IERC20);
    function escrow() external view returns (address);
    function arbitration() external view returns (address);
    function depositServiceFee(uint256 projectId, uint256 milestoneIndex, uint256 amount) external;
    function depositDisputeFee(uint256 disputeId) external;
}
