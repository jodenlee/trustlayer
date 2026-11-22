// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";

/// @dev TEST ONLY: transfer/approval faults, selective late-finalization faults, and callbacks.
contract TreasuryTestToken is ERC20 {
    enum Mode { NORMAL, RETURN_FALSE, TAKE_FEE, CALLBACK, REJECT_APPROVE }
    Mode public mode;
    address public callbackTarget;
    bytes public callbackData;
    address public callbackRecipient;
    address public blockedFrom;
    address public blockedTo;
    error TransferBlocked();

    constructor(address holder) ERC20("Treasury Test Token", "TTT") {
        _mint(holder, 1_000_000 * 10 ** 6);
    }

    function decimals() public pure override returns (uint8) { return 6; }

    function configure(Mode mode_, address target, bytes calldata data) external {
        mode = mode_;
        callbackTarget = target;
        callbackData = data;
    }

    function blockTransfer(address from, address to) external {
        blockedFrom = from;
        blockedTo = to;
    }

    function setCallbackRecipient(address recipient) external { callbackRecipient = recipient; }

    function approve(address spender, uint256 amount) public override returns (bool) {
        if (mode == Mode.REJECT_APPROVE) return false;
        return super.approve(spender, amount);
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        if (mode == Mode.RETURN_FALSE) return false;
        if (mode == Mode.CALLBACK && (callbackRecipient == address(0) || callbackRecipient == to)) Address.functionCall(callbackTarget, callbackData);
        return super.transfer(to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        if (mode == Mode.RETURN_FALSE) return false;
        if (mode == Mode.CALLBACK && (callbackRecipient == address(0) || callbackRecipient == to)) Address.functionCall(callbackTarget, callbackData);
        return super.transferFrom(from, to, amount);
    }

    function _update(address from, address to, uint256 amount) internal override {
        if (from != address(0) && from == blockedFrom && to == blockedTo) revert TransferBlocked();
        if (mode == Mode.TAKE_FEE && from != address(0) && to != address(0) && amount > 0) {
            super._update(from, to, amount - 1);
            super._update(from, address(0), 1);
        } else super._update(from, to, amount);
    }
}
