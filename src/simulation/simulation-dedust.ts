import { Factory, MAINNET_FACTORY_ADDR, ReadinessStatus, Asset, PoolType, VaultJetton } from "@dedust/sdk";
import { Address, SendMode, Slice, toNano, Transaction } from "@ton/core";
import { Blockchain, SandboxContract, TreasuryContract, printTransactionFees } from "@ton/sandbox";
import { SimulationResult, StageResult } from "./simulation";
import { allTxsOk, createTransferBody, difference as calculateLoss, getJettonBalance, getJettonWallet } from "./simulation-utils";

export async function sinulateDedust(chain: Blockchain, master: Address, simulator: SandboxContract<TreasuryContract>,
    jettonWallet: Address, buyAmount: bigint): Promise<SimulationResult | null> {
    const factory = chain.openContract(Factory.createFromAddress(MAINNET_FACTORY_ADDR));
    const tonVault = chain.openContract(await factory.getNativeVault());
    const jettonVault = chain.openContract(await factory.getJettonVault(master));
    if ((await tonVault.getReadinessStatus()) !== ReadinessStatus.READY ||
        (await jettonVault.getReadinessStatus() !== ReadinessStatus.READY))
        return null;
    const tonAsset = Asset.native();
    const jettonAsset = Asset.jetton(master);

    const pool = chain.openContract(await factory.getPool(PoolType.VOLATILE, [tonAsset, jettonAsset]));
    if ((await pool.getReadinessStatus()) !== ReadinessStatus.READY)
        return null;
    const estimatedBuy = await pool.getEstimatedSwapOut({
        assetIn: tonAsset,
        amountIn: buyAmount
    });

    let result = await tonVault.sendSwap(simulator.getSender(), {
        queryId: 0,
        poolAddress: pool.address,
        amount: buyAmount,
        gasAmount: toNano(0.25)
    });

    console.log("BUY TABLE");
    printTransactionFees(result.transactions);

    if (!allTxsOk(result.transactions))
        return {
            transfer: null,
            buy: null,
            sell: null
        };

    const actualBalance = await getJettonBalance(chain, jettonWallet);
    const buyResult: StageResult = {
        loss: calculateLoss(actualBalance, estimatedBuy.amountOut)
    }

    console.log("Actual jetton payout:", actualBalance);
    console.log("Estimated jetton payout:", estimatedBuy.amountOut);
    console.log("Buy diff:", buyResult.loss);

    const transferResult = await simulateTransfer(chain, master, simulator, jettonWallet, actualBalance);

    const estimatedSell = await pool.getEstimatedSwapOut({
        assetIn: jettonAsset,
        amountIn: actualBalance
    });

    const payload = VaultJetton.createSwapPayload({ poolAddress: pool.address });
    result = await simulator.send({
        to: jettonWallet,
        value: toNano(0.3),
        sendMode: SendMode.PAY_GAS_SEPARATELY,
        body: createTransferBody(actualBalance, jettonVault.address, simulator.address, toNano(0.25), payload)
    });

    console.log("SELL TABLE");
    printTransactionFees(result.transactions);

    if (!allTxsOk(result.transactions))
        return {
            transfer: transferResult,
            buy: buyResult,
            sell: null
        };

    const actualTonPayout = getActualPayout(result.transactions, pool.address);
    const sellResult: StageResult = {
        loss: calculateLoss(actualTonPayout, estimatedSell.amountOut)
    }

    console.log("Actual ton payout:", actualTonPayout);
    console.log("Estimated ton payout:", estimatedSell.amountOut);
    console.log("Sell diff:", sellResult.loss);

    return {
        transfer: transferResult,
        buy: buyResult,
        sell: sellResult
    }
}

async function simulateTransfer(chain: Blockchain, master: Address,
        simulator: SandboxContract<TreasuryContract>, jettonWallet: Address, amount: bigint): Promise<StageResult | null> {
    const snapshot = chain.snapshot();

    const another = await chain.treasury("another");
    const result = await simulator.send({
        to: jettonWallet,
        value: toNano(0.06),
        sendMode: SendMode.PAY_GAS_SEPARATELY,
        body: createTransferBody(amount, another.address, simulator.address, 1n, null)
    });

    console.log("TRANSFER TABLE");
    printTransactionFees(result.transactions);

    if (!allTxsOk(result.transactions))
        return null

    const anotherJettonWallet = await getJettonWallet(chain, another.address, master);
    const state = (await chain.getContract(anotherJettonWallet)).accountState;
    const balance = state?.type === "active" ? await getJettonBalance(chain, anotherJettonWallet) : 0n;
    const loss = calculateLoss(balance, amount);

    console.log("Actual transferred:", balance);
    console.log("Expected transferred", amount);
    console.log("Transfer diff:", loss);

    await chain.loadFrom(snapshot);
    return {
        loss: loss
    };
}

function getActualPayout(transactions: Transaction[], pool: Address): bigint {
    for (const tx of transactions) {
        if (tx.description.type !== "generic")
            continue;
        for (const child of tx.outMessages.values()) {
            if (child.info.type !== "external-out" || !child.info.src.equals(pool))
                continue;
            const body = child.body.beginParse();
            const op = body.loadUint(32);
            if (op !== 0x9c610de3)
                continue;
            skipAsset(body); // asset in
            skipAsset(body); // asset out
            body.loadCoins(); // amount in
            return body.loadCoins() // amount out
        }
    }
    return 0n;
}

function skipAsset(cs: Slice) {
    const type = cs.loadUint(4);
    if (type === 0b0001)
        cs.skip(264);
    else if (type === 0b0010)
        cs.skip(32);
}