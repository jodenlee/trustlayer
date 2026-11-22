// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IJurorRewards {
    event JurorRewardsReserved(uint256 indexed disputeId, uint256 amount);
    event JurorRewardClaimed(uint256 indexed disputeId, address indexed juror, uint256 amount);
    event ProtocolFeeDeposited(uint256 indexed disputeId, address indexed treasury, uint256 amount);

    function claimableReward(uint256 disputeId, address juror) external view returns (uint256);
    function claimJurorReward(uint256 disputeId) external;
}
