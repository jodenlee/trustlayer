# Integration test plan

Test runner: Hardhat 3, Node.js test runner + Viem. Add executable TypeScript tests after dependency installation.

Required first tests:
1. Create valid 400/600 mUSD project; reject zero, unsorted deadlines and unrecognized freelancer.
2. Funding requires full allowance; escrow balance equals `totalEscrowLiability`.
3. Only nominated freelancer can accept and submit.
4. Approval of 400 mUSD transfers 396 to freelancer and 4 to treasury.
5. Cannot settle same milestone twice or skip to milestone 2.
6. Review-time auto-release is blocked until 72 hours have passed.
7. Missed-delivery refund is blocked until after due date + 48 hours.
8. Unaccepted offer refund works only after 7 days.
9. Escrow balance always >= `totalEscrowLiability`.

These are documented acceptance tests, not an assertion that tests already pass.
