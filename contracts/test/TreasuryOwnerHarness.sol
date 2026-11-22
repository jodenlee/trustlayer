// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface ITreasuryOwnerActions {
    function acceptOwnership() external;
    function withdraw(address recipient, uint256 amount) external;
}

/// @dev TEST ONLY: contract owner to prove reentrancy is blocked even when ownership checks pass.
contract TreasuryOwnerHarness {
    function accept(address treasury) external { ITreasuryOwnerActions(treasury).acceptOwnership(); }
    function withdraw(address treasury, address recipient, uint256 amount) external {
        ITreasuryOwnerActions(treasury).withdraw(recipient, amount);
    }
}
