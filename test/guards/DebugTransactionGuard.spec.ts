import { expect } from "chai";
import hre, { deployments } from "hardhat";
import "@nomiclabs/hardhat-ethers";
import { getContractFactoryByName, getMock, getSafeWithOwners, getWallets } from "../utils/setup";
import { buildSafeTransaction, calculateSafeTransactionHash, executeContractCallWithSigners, executeTxWithSigners } from "../../src/utils/execution";
import { chainId } from "../utils/encoding";

describe("DebugTransactionGuard", async () => {

    const [user1] = getWallets(hre);

    const setupTests = deployments.createFixture(async ({ deployments }) => {
        await deployments.fixture();
        const safe = await getSafeWithOwners([user1.address])
        const guardFactory = await getContractFactoryByName("DebugTransactionGuard")
        const guard = await guardFactory.deploy()
        await guard.deployed()
        const mock = await getMock()
        await (await executeContractCallWithSigners(safe, safe, "setGuard", [guard.address], [user1])).wait()
        return {
            safe,
            mock,
            guardFactory,
            guard
        }
    })

    describe("fallback", async () => {
        it('must NOT revert on fallback without value', async () => {
            const { guard } = await setupTests()
            await user1.sendTransaction({
                to: guard.address,
                data: "0xbaddad"
            })
        })
        it('should revert on fallback with value', async () => {
            const { guard } = await setupTests()
            await expect(
                user1.sendTransaction({
                    to: guard.address,
                    data: "0xbaddad",
                    value: 1
                })
            ).to.be.reverted
        })
    })

    describe("checkTransaction", async () => {
        it('should emit debug events', async () => {
            const { safe, mock, guard } = await setupTests()
            const nonce = await safe.nonce()
            const safeTx = buildSafeTransaction({ to: mock.address, data: "0xbaddad42", nonce })
            const safeTxHash = calculateSafeTransactionHash(safe, safeTx, await chainId())

            await expect(
                executeTxWithSigners(safe, safeTx, [user1])
            ).to.emit(guard, "TransactionDetails").withArgs(
                safe.address,
                safeTxHash,
                safeTx.to,
                safeTx.value,
                safeTx.data,
                safeTx.operation,
                safeTx.safeTxGas,
                false,
                safeTx.nonce
            ).and.to.emit(guard, "GasUsage").withArgs(safe.address, safeTxHash, nonce, true)
            
            expect(await mock.callStatic.invocationCount()).to.be.eq(1);
            expect(await mock.callStatic.invocationCountForCalldata("0xbaddad42")).to.be.eq(1);
        })
    })
})
