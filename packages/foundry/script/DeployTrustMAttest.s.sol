// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./DeployHelpers.s.sol";
import { TrustMAttest } from "../contracts/TrustMAttest.sol";

/// The CA public key lives in the contract itself (TrustMAttest.CA_X / CA_Y). For a chip from another CA,
/// change it there; `tools/chip.py cert` prints the cert's issuer.
contract DeployTrustMAttest is ScaffoldETHDeploy {
    function run() external ScaffoldEthDeployerRunner {
        new TrustMAttest();
    }
}
