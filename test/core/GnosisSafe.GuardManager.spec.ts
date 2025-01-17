import { expect } from "chai";
import hre, { deployments, ethers } from "hardhat";
import { BigNumber } from "ethers";
import "@nomiclabs/hardhat-ethers";
import { AddressZero } from "@ethersproject/constants";
import { getMock, getSafeWithOwners, getWallets } from "../utils/setup";
import { buildContractCall, buildSafeTransaction, buildSignatureBytes, calculateSafeTransactionHash, executeContractCallWithSigners, executeTx, safeApproveHash } from "../../src/utils/execution";
import { chainId } from "../utils/encoding";

describe("GuardManager", async () => {

    const [user1, user2] = getWallets(hre);

    const setupWithTemplate = deployments.createFixture(async ({ deployments }) => {
        await deployments.fixture();
        const mock = await getMock();
        const safe = await getSafeWithOwners([user2.address])
        await (await executeContractCallWithSigners(safe, safe, "setGuard", [mock.address], [user2])).wait()
        return {
            safe,
            mock
        }
    })

    describe("setGuard", async () => {

        it('is not called when setting initially', async () => {
            const { safe, mock } = await setupWithTemplate()

            const slot = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("guard_manager.guard.address"))

            await (await executeContractCallWithSigners(safe, safe, "setGuard", [AddressZero], [user2])).wait()

            // Check fallback handler
            await expect(
                await hre.ethers.provider.getStorageAt(safe.address, slot)
            ).to.be.eq("0x" + "".padStart(64, "0"))

            await (await mock.reset()).wait()

            await expect(
                await executeContractCallWithSigners(safe, safe, "setGuard", [mock.address], [user2])
            ).to.emit(safe, "ChangedGuard").withArgs(mock.address)

            // Check fallback handler
            await expect(
                await hre.ethers.provider.getStorageAt(safe.address, slot)
            ).to.be.eq("0x" + mock.address.toLowerCase().slice(2).padStart(64, "0"))
            
            // Guard should not be called, as it was not set before the transaction execution
            expect(await mock.callStatic.invocationCount()).to.be.eq(0);
        })

        it('is called when removed', async () => {
            const { safe, mock } = await setupWithTemplate()

            const slot = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("guard_manager.guard.address"))

            // Check fallback handler
            await expect(
                await hre.ethers.provider.getStorageAt(safe.address, slot)
            ).to.be.eq("0x" + mock.address.toLowerCase().slice(2).padStart(64, "0"))

            const safeTx = buildContractCall(safe, "setGuard", [AddressZero], await safe.nonce())
            const signature = await safeApproveHash(user2, safe, safeTx)
            const signatureBytes = buildSignatureBytes([signature])

            await expect(
                executeTx(safe, safeTx, [signature])
            ).to.emit(safe, "ChangedGuard").withArgs(AddressZero)

            // Check fallback handler
            await expect(
                await hre.ethers.provider.getStorageAt(safe.address, slot)
            ).to.be.eq("0x" + "".padStart(64, "0"))
            
            expect(await mock.callStatic.invocationCount()).to.be.eq(2);
            const guardInterface = (await hre.ethers.getContractAt("Guard", mock.address)).interface
            const checkTxData = guardInterface.encodeFunctionData("checkTransaction", [
                safeTx.to, safeTx.value, safeTx.data, safeTx.operation, safeTx.safeTxGas,
                safeTx.baseGas, safeTx.gasPrice, safeTx.gasToken, safeTx.refundReceiver,
                signatureBytes, user1.address
            ])
            expect(await mock.callStatic.invocationCountForCalldata(checkTxData)).to.be.eq(1);
            // Guard should also be called for post exec check, even if it is removed with the Safe tx
            const checkExecData = guardInterface.encodeFunctionData("checkAfterExecution", [calculateSafeTransactionHash(safe, safeTx, await chainId()), true])
            expect(await mock.callStatic.invocationCountForCalldata(checkExecData)).to.be.eq(1);
        })
    })

    describe("execTransaction", async () => {
        it('reverts if the pre hook of the guard reverts', async () => {
            const { safe, mock } = await setupWithTemplate()

            const safeTx = buildSafeTransaction({ to: mock.address, data: "0xbaddad42", nonce: 1 })
            const signature = await safeApproveHash(user2, safe, safeTx)
            const signatureBytes = buildSignatureBytes([signature])
            const guardInterface = (await hre.ethers.getContractAt("Guard", mock.address)).interface
            const checkTxData = guardInterface.encodeFunctionData("checkTransaction", [
                safeTx.to, safeTx.value, safeTx.data, safeTx.operation, safeTx.safeTxGas,
                safeTx.baseGas, safeTx.gasPrice, safeTx.gasToken, safeTx.refundReceiver,
                signatureBytes, user1.address
            ])
            await (await mock.givenCalldataRevertWithMessage(checkTxData, "Computer says Nah")).wait()
            const checkExecData = guardInterface.encodeFunctionData("checkAfterExecution", [calculateSafeTransactionHash(safe, safeTx, await chainId()), true])

            await expect(
                executeTx(safe, safeTx, [signature])
            ).to.be.revertedWith("Computer says Nah")

            await (await mock.reset()).wait()

            await expect(
                executeTx(safe, safeTx, [signature])
            ).to.emit(safe, "ExecutionSuccess")

            expect(await mock.callStatic.invocationCount()).to.be.deep.equals(BigNumber.from(3));
            expect(await mock.callStatic.invocationCountForCalldata(checkTxData)).to.be.deep.equals(BigNumber.from(1));
            expect(await mock.callStatic.invocationCountForCalldata(checkExecData)).to.be.deep.equals(BigNumber.from(1));
            expect(await mock.callStatic.invocationCountForCalldata("0xbaddad42")).to.be.deep.equals(BigNumber.from(1));
        })

        it('reverts if the post hook of the guard reverts', async () => {
            const { safe, mock } = await setupWithTemplate()

            const safeTx = buildSafeTransaction({ to: mock.address, data: "0xbaddad42", nonce: 1 })
            const signature = await safeApproveHash(user2, safe, safeTx)
            const signatureBytes = buildSignatureBytes([signature])
            const guardInterface = (await hre.ethers.getContractAt("Guard", mock.address)).interface
            const checkTxData = guardInterface.encodeFunctionData("checkTransaction", [
                safeTx.to, safeTx.value, safeTx.data, safeTx.operation, safeTx.safeTxGas,
                safeTx.baseGas, safeTx.gasPrice, safeTx.gasToken, safeTx.refundReceiver,
                signatureBytes, user1.address
            ])
            const checkExecData = guardInterface.encodeFunctionData("checkAfterExecution", [calculateSafeTransactionHash(safe, safeTx, await chainId()), true])
            await (await mock.givenCalldataRevertWithMessage(checkExecData, "Computer says Nah")).wait()

            await expect(
                executeTx(safe, safeTx, [signature])
            ).to.be.revertedWith("Computer says Nah")

            await (await mock.reset()).wait()

            await expect(
                executeTx(safe, safeTx, [signature])
            ).to.emit(safe, "ExecutionSuccess")

            expect(await mock.callStatic.invocationCount()).to.be.deep.equals(BigNumber.from(3));
            expect(await mock.callStatic.invocationCountForCalldata(checkTxData)).to.be.deep.equals(BigNumber.from(1));
            expect(await mock.callStatic.invocationCountForCalldata(checkExecData)).to.be.deep.equals(BigNumber.from(1));
            expect(await mock.callStatic.invocationCountForCalldata("0xbaddad42")).to.be.deep.equals(BigNumber.from(1));
        })
    })
})
