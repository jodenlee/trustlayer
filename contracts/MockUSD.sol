// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice A six-decimal fictional demo token. No real-world monetary value.
/// @dev Local/test environments only; never deploy as a real stablecoin.
contract MockUSD is ERC20 {
    constructor(address initialHolder) ERC20("Mock USD", "mUSD") {
        _mint(initialHolder, 1_000_000 * 10 ** 6);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}
