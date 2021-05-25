import chai, { expect } from 'chai'
import { BigNumber, Contract } from 'ethers'
import { solidity, createFixtureLoader } from 'ethereum-waffle'
import hre, { ethers, waffle } from 'hardhat'

import { expandTo18Decimals, mineBlock, latestBlockTimestamp, MINIMUM_LIQUIDITY } from './shared/utilities'
import { v2Fixture } from './shared/fixtures'

chai.use(solidity)

const overrides = {
    gasLimit: 9999999,
}

describe('SaveYourPancakeRouter', () => {
    const [owner, wallet] = waffle.provider.getWallets()
    const loadFixture = createFixtureLoader([owner])

    let token0: Contract
    let token1: Contract
    let WETH: Contract
    let WETHPartner: Contract
    let factory: Contract
    let router: Contract
    let pair: Contract
    let WETHPair: Contract
    let routerEventEmitter: Contract

    async function addLiquidity(token0Amount: BigNumber, token1Amount: BigNumber) {
        await token0.transfer(pair.address, token0Amount)
        await token1.transfer(pair.address, token1Amount)
        await pair.mint(wallet.address, overrides)
    }

    beforeEach(async function () {
        const fixture = await loadFixture(v2Fixture)
        token0 = fixture.token0
        token1 = fixture.token1
        WETH = fixture.WETH
        WETHPartner = fixture.WETHPartner
        factory = fixture.factoryV2
        router = fixture.router
        pair = fixture.pair
        WETHPair = fixture.WETHPair
        routerEventEmitter = fixture.routerEventEmitter
    })

    afterEach(async function () {
        //expect(await owner.getBalance(router.address)).to.eq(ethers.constants.Zero)
    })

    describe('Router', () => {
        it('factory, WETH', async () => {
            expect(await router.factory()).to.eq(factory.address)
            expect(await router.WETH()).to.eq(WETH.address)
        })

        describe('swapExactTokensForTokens', () => {
            const token0Amount = expandTo18Decimals(5)
            const token1Amount = expandTo18Decimals(10)
            const swapAmount = expandTo18Decimals(1)
            const expectedOutputAmount = BigNumber.from('1662497915624478906')

            beforeEach(async () => {
                await addLiquidity(token0Amount, token1Amount)
                await token0.approve(router.address, ethers.constants.MaxUint256)
            })

            it('happy path', async () => {
                await expect(
                    router.swapExactTokensForTokens(
                        swapAmount,
                        0,
                        [token0.address, token1.address],
                        wallet.address,
                        ethers.constants.MaxUint256,
                        overrides
                    )
                )
                    .to.emit(token0, 'Transfer')
                    .withArgs(wallet.address, pair.address, swapAmount)
                    .to.emit(token1, 'Transfer')
                    .withArgs(pair.address, wallet.address, expectedOutputAmount)
                    .to.emit(pair, 'Sync')
                    .withArgs(token0Amount.add(swapAmount), token1Amount.sub(expectedOutputAmount))
                    .to.emit(pair, 'Swap')
                    .withArgs(router.address, swapAmount, 0, 0, expectedOutputAmount, wallet.address)
            })

            it('amounts', async () => {
                await token0.approve(routerEventEmitter.address, ethers.constants.MaxUint256)
                await expect(
                    routerEventEmitter.swapExactTokensForTokens(
                        router.address,
                        swapAmount,
                        0,
                        [token0.address, token1.address],
                        wallet.address,
                        ethers.constants.MaxUint256,
                        overrides
                    )
                )
                    .to.emit(routerEventEmitter, 'Amounts')
                    .withArgs([swapAmount, expectedOutputAmount])
            })

            it('gas', async () => {
                // ensure that setting price{0,1}CumulativeLast for the first time doesn't affect our gas math
                await mineBlock(await latestBlockTimestamp())
                await pair.sync(overrides)

                await token0.approve(router.address, ethers.constants.MaxUint256)
                await mineBlock(await latestBlockTimestamp())
                const tx = await router.swapExactTokensForTokens(
                    swapAmount,
                    0,
                    [token0.address, token1.address],
                    wallet.address,
                    ethers.constants.MaxUint256,
                    overrides
                )
                const receipt = await tx.wait()
                expect(receipt.gasUsed).to.eq(101876)
            }).retries(3)
        })

        describe('swapExactETHForTokens', () => {
            const WETHPartnerAmount = expandTo18Decimals(10)
            const ETHAmount = expandTo18Decimals(5)
            const swapAmount = expandTo18Decimals(1)
            const expectedOutputAmount = BigNumber.from('1662497915624478906')

            beforeEach(async () => {
                await WETHPartner.transfer(WETHPair.address, WETHPartnerAmount)
                await WETH.deposit({ value: ETHAmount })
                await WETH.transfer(WETHPair.address, ETHAmount)
                await WETHPair.mint(wallet.address, overrides)

                await token0.approve(router.address, ethers.constants.MaxUint256)
            })

            it('happy path', async () => {
                const WETHPairToken0 = await WETHPair.token0()
                await expect(
                    router.swapExactETHForTokens(0, [WETH.address, WETHPartner.address], wallet.address, ethers.constants.MaxUint256, {
                        ...overrides,
                        value: swapAmount,
                    })
                )
                    .to.emit(WETH, 'Transfer')
                    .withArgs(router.address, WETHPair.address, swapAmount)
                    .to.emit(WETHPartner, 'Transfer')
                    .withArgs(WETHPair.address, wallet.address, expectedOutputAmount)
                    .to.emit(WETHPair, 'Sync')
                    .withArgs(
                        WETHPairToken0 === WETHPartner.address ? WETHPartnerAmount.sub(expectedOutputAmount) : ETHAmount.add(swapAmount),
                        WETHPairToken0 === WETHPartner.address ? ETHAmount.add(swapAmount) : WETHPartnerAmount.sub(expectedOutputAmount)
                    )
                    .to.emit(WETHPair, 'Swap')
                    .withArgs(
                        router.address,
                        WETHPairToken0 === WETHPartner.address ? 0 : swapAmount,
                        WETHPairToken0 === WETHPartner.address ? swapAmount : 0,
                        WETHPairToken0 === WETHPartner.address ? expectedOutputAmount : 0,
                        WETHPairToken0 === WETHPartner.address ? 0 : expectedOutputAmount,
                        wallet.address
                    )
            })

            it('amounts', async () => {
                await expect(
                    routerEventEmitter.swapExactETHForTokens(
                        router.address,
                        0,
                        [WETH.address, WETHPartner.address],
                        wallet.address,
                        ethers.constants.MaxUint256,
                        {
                            ...overrides,
                            value: swapAmount,
                        }
                    )
                )
                    .to.emit(routerEventEmitter, 'Amounts')
                    .withArgs([swapAmount, expectedOutputAmount])
            })

            it('gas', async () => {
                const WETHPartnerAmount = expandTo18Decimals(10)
                const ETHAmount = expandTo18Decimals(5)
                await WETHPartner.transfer(WETHPair.address, WETHPartnerAmount)
                await WETH.deposit({ value: ETHAmount })
                await WETH.transfer(WETHPair.address, ETHAmount)
                await WETHPair.mint(wallet.address, overrides)

                // ensure that setting price{0,1}CumulativeLast for the first time doesn't affect our gas math
                await mineBlock(await latestBlockTimestamp())
                await pair.sync(overrides)

                const swapAmount = expandTo18Decimals(1)
                await mineBlock(await latestBlockTimestamp())
                const tx = await router.swapExactETHForTokens(
                    0,
                    [WETH.address, WETHPartner.address],
                    wallet.address,
                    ethers.constants.MaxUint256,
                    {
                        ...overrides,
                        value: swapAmount,
                    }
                )
                const receipt = await tx.wait()
                expect(receipt.gasUsed).to.eq(138770)
            }).retries(3)
        })

        describe('swapExactTokensForETH', () => {
            const WETHPartnerAmount = expandTo18Decimals(5)
            const ETHAmount = expandTo18Decimals(10)
            const swapAmount = expandTo18Decimals(1)
            const expectedOutputAmount = BigNumber.from('1662497915624478906')

            beforeEach(async () => {
                await WETHPartner.transfer(WETHPair.address, WETHPartnerAmount)
                await WETH.deposit({ value: ETHAmount })
                await WETH.transfer(WETHPair.address, ETHAmount)
                await WETHPair.mint(wallet.address, overrides)
            })

            it('happy path', async () => {
                await WETHPartner.approve(router.address, ethers.constants.MaxUint256)
                const WETHPairToken0 = await WETHPair.token0()
                await expect(
                    router.swapExactTokensForETH(
                        swapAmount,
                        0,
                        [WETHPartner.address, WETH.address],
                        wallet.address,
                        ethers.constants.MaxUint256,
                        overrides
                    )
                )
                    .to.emit(WETHPartner, 'Transfer')
                    .withArgs(wallet.address, WETHPair.address, swapAmount)
                    .to.emit(WETH, 'Transfer')
                    .withArgs(WETHPair.address, router.address, expectedOutputAmount)
                    .to.emit(WETHPair, 'Sync')
                    .withArgs(
                        WETHPairToken0 === WETHPartner.address ? WETHPartnerAmount.add(swapAmount) : ETHAmount.sub(expectedOutputAmount),
                        WETHPairToken0 === WETHPartner.address ? ETHAmount.sub(expectedOutputAmount) : WETHPartnerAmount.add(swapAmount)
                    )
                    .to.emit(WETHPair, 'Swap')
                    .withArgs(
                        router.address,
                        WETHPairToken0 === WETHPartner.address ? swapAmount : 0,
                        WETHPairToken0 === WETHPartner.address ? 0 : swapAmount,
                        WETHPairToken0 === WETHPartner.address ? 0 : expectedOutputAmount,
                        WETHPairToken0 === WETHPartner.address ? expectedOutputAmount : 0,
                        router.address
                    )
            })

            it('amounts', async () => {
                await WETHPartner.approve(routerEventEmitter.address, ethers.constants.MaxUint256)
                await expect(
                    routerEventEmitter.swapExactTokensForETH(
                        router.address,
                        swapAmount,
                        0,
                        [WETHPartner.address, WETH.address],
                        wallet.address,
                        ethers.constants.MaxUint256,
                        overrides
                    )
                )
                    .to.emit(routerEventEmitter, 'Amounts')
                    .withArgs([swapAmount, expectedOutputAmount])
            })
        })
    })
})
