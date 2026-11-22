// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";

/// @dev TEST ONLY: exercises unsupported tokens, failed transfers and reentrant callbacks.
contract RegistryTestToken is ERC20 {
    enum TransferMode { NORMAL, RETURN_FALSE, TAKE_FEE, CALLBACK }

    uint8 private immutable _decimals;
    TransferMode public transferMode;
    address public callbackTarget;
    bytes public callbackData;

    constructor(address holder, uint8 decimals_) ERC20("Registry Test Token", "RTT") {
        _decimals = decimals_;
        _mint(holder, 1_000_000 * 10 ** 6);
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function setTransferMode(TransferMode mode, address target, bytes calldata data) external {
        transferMode = mode;
        callbackTarget = target;
        callbackData = data;
    }

    function transfer(address to, uint256 value) public override returns (bool) {
        if (transferMode == TransferMode.RETURN_FALSE) return false;
        if (transferMode == TransferMode.CALLBACK) Address.functionCall(callbackTarget, callbackData);
        return super.transfer(to, value);
    }

    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        if (transferMode == TransferMode.RETURN_FALSE) return false;
        if (transferMode == TransferMode.CALLBACK) Address.functionCall(callbackTarget, callbackData);
        return super.transferFrom(from, to, value);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (transferMode == TransferMode.TAKE_FEE && from != address(0) && to != address(0) && value != 0) {
            super._update(from, to, value - 1);
            super._update(from, address(0), 1);
        } else {
            super._update(from, to, value);
        }
    }
}
