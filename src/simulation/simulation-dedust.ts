import { VaultJetton, Pool, VaultNative, Factory, MAINNET_FACTORY_ADDR, Asset, ReadinessStatus } from "@dedust/sdk";
import { Address, SendMode, Slice, toNano, Transaction } from "@ton/core";
import { Blockchain, SandboxContract, TreasuryContract } from "@ton/sandbox";
import { createJettonTransferBody, getJettonBalance } from "./simulation-utils";
import { Simulation, StageSimulationInfo } from "./simulation";

export class DedustSimulation extends Simulation {
    private readonly amountIn: bigint;
    private readonly assetIn: Asset;
    private readonly assetOut: Asset;
    private readonly vaultIn: SandboxContract<VaultNative>;
    private readonly vaultOut: SandboxContract<VaultJetton>;
    private readonly pool: SandboxContract<Pool>;

    private constructor(chain: Blockchain, master: Address, amountIn: bigint,
        assetIn: Asset, assetOut: Asset,
        vaultIn: SandboxContract<VaultNative>, vaultOut: SandboxContract<VaultJetton>,
        pool: SandboxContract<Pool>
    ) {
        super(chain, master);
        this.amountIn = amountIn;
        this.assetIn = assetIn;
        this.assetOut = assetOut;
        this.vaultIn = vaultIn;
        this.vaultOut = vaultOut;
        this.pool = pool;
    }

    public static async create(chain: Blockchain, master: Address, pool: Address, amountIn: bigint) {
        const factory = chain.openContract(Factory.createFromAddress(MAINNET_FACTORY_ADDR));
        const assetIn = Asset.native();
        const assetOut = Asset.jetton(master);
        const poolContract = chain.openContract(Pool.createFromAddress(pool));
        if (await poolContract.getReadinessStatus() !== ReadinessStatus.READY)
            throw new Error("Pool is not ready");
        const vaultIn = chain.openContract(await factory.getNativeVault());
        if (await vaultIn.getReadinessStatus() !== ReadinessStatus.READY)
            throw new Error("Native vaultIn is not ready");
        const vaultOut = chain.openContract(await factory.getJettonVault(master));
        if (await vaultOut.getReadinessStatus() !== ReadinessStatus.READY)
            throw new Error("Jetton vaultOut is not ready");
        return new DedustSimulation(chain, master, amountIn, assetIn,
            assetOut, vaultIn, vaultOut, poolContract
        );
    }

    protected async simulateBuy(treasury: SandboxContract<TreasuryContract>, jettonWallet: Address)
        : Promise<StageSimulationInfo | null> {
        const estimate = await this.pool.getEstimatedSwapOut({
            assetIn: this.assetIn,
            amountIn: this.amountIn
        });

        const result = await this.vaultIn.sendSwap(treasury.getSender(), {
            queryId: 0,
            poolAddress: this.pool.address,
            amount: this.amountIn,
            gasAmount: toNano(0.25)
        });
        const actualBalance = await getJettonBalance(this.chain, jettonWallet);
        return {
            transactions: result.transactions,
            actualAmount: actualBalance,
            expectedAmount: estimate.amountOut
        }
    }

    protected async simulateSell(treasury: SandboxContract<TreasuryContract>, jettonWallet: Address)
        : Promise<StageSimulationInfo | null> {
        const balance = await getJettonBalance(this.chain, jettonWallet);
        const estimate = await this.pool.getEstimatedSwapOut({
            assetIn: this.assetOut,
            amountIn: balance
        });

        const payload = VaultJetton.createSwapPayload({ poolAddress: this.pool.address });
        const result = await treasury.send({
            to: jettonWallet,
            value: toNano(0.3),
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: createJettonTransferBody({
                amount: balance,
                destination: this.vaultOut.address,
                response: treasury.address,
                forwardAmount: toNano(0.25),
                payload: payload
            })
        });

        const actualPayout = DedustSimulation.getActualPayout(result.transactions, this.pool.address);
        return {
            transactions: result.transactions,
            actualAmount: actualPayout,
            expectedAmount: estimate.amountOut
        }
    }

    private static getActualPayout(transactions: Transaction[], pool: Address): bigint {
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
                DedustSimulation.skipAsset(body); // asset in
                DedustSimulation.skipAsset(body); // asset out
                body.loadCoins(); // amount in
                return body.loadCoins() // amount out
            }
        }
        return 0n;
    }

    private static skipAsset(cs: Slice) {
        const type = cs.loadUint(4);
        if (type === 0b0001)
            cs.skip(264);
        else if (type === 0b0010)
            cs.skip(32);
    }
}