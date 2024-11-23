import { Blockchain, BlockchainTransaction, SandboxContract, TreasuryContract } from "@ton/sandbox";
import { Address, toNano } from "@ton/core";
import { PoolV1, PtonV1, RouterV1 } from "../stonfi";
import { createJettonTransferBody, getJettonBalance, getJettonWallet } from "./simulation-utils";
import { Simulation, StageSimulationInfo } from "./simulation";

const FORWARD_FEE = toNano(0.25);

export class StonfiV1Simulation extends Simulation {
    private readonly router: RouterV1;
    private readonly walletIn: Address;
    private readonly walletOut: Address;
    private readonly pool: SandboxContract<PoolV1>;
    private readonly amountIn: bigint;

    private constructor(chain: Blockchain, master: Address, router: RouterV1, walletIn: Address,
        walletOut: Address, pool: SandboxContract<PoolV1>, amountIn: bigint
    ) {
        super(chain, master);
        this.router = router
        this.walletIn = walletIn;
        this.walletOut = walletOut;
        this.pool = pool;
        this.amountIn = amountIn;
    }

    public static async create(chain: Blockchain, master: Address, pool: Address, amountIn: bigint): Promise<StonfiV1Simulation> {
        const router = new RouterV1();
        const walletIn = await getJettonWallet(chain, router.address, PtonV1.address);
        const walletOut = await getJettonWallet(chain, router.address, master);
        const poolContract = chain.openContract(PoolV1.create(pool));
        return new StonfiV1Simulation(chain, master, router, walletIn, 
            walletOut, poolContract, amountIn
        );
    }

    protected async simulateBuy(treasury: SandboxContract<TreasuryContract>, jettonWallet: Address): Promise<StageSimulationInfo | null> {
        const estimate = await this.pool.getExpectedOutputs({
            amount: this.amountIn,
            jettonWallet: this.walletIn
        });

        const swapPayload = await this.router.createSwapBody({
            userWalletAddress: treasury.address,
            minAskAmount: 0n,
            askJettonWalletAddress: this.walletOut
        });

        const result = await treasury.send({
            to: this.walletIn,
            value: this.amountIn + FORWARD_FEE,
            body: createJettonTransferBody({
                amount: this.amountIn,
                destination: this.router.address,
                forwardAmount: FORWARD_FEE,
                payload: swapPayload
            })
        });
        const actualBalance = await getJettonBalance(this.chain, jettonWallet);
        return {
            transactions: result.transactions,
            actualAmount: actualBalance,
            expectedAmount: estimate.jettonToReceive
        }
    }

    protected async simulateSell(treasury: SandboxContract<TreasuryContract>, jettonWallet: Address): Promise<StageSimulationInfo | null> {
        const balance = await getJettonBalance(this.chain, jettonWallet);
        const estimate = await this.pool.getExpectedOutputs({
            amount: balance,
            jettonWallet: this.walletOut
        });

        const swapPayload = await this.router.createSwapBody({
            userWalletAddress: treasury.address,
            minAskAmount: 0n,
            askJettonWalletAddress: this.walletIn
        });

        const result = await treasury.send({
            to: jettonWallet,
            value: toNano(0.06) + FORWARD_FEE,
            body: createJettonTransferBody({
                amount: balance,
                destination: this.router.address,
                response: treasury.address,
                forwardAmount: FORWARD_FEE,
                payload: swapPayload
            })
        });
        const actualPayout = StonfiV1Simulation.getActualPayout(result.transactions, 
            this.pool.address, this.walletIn
        );
        return {
            transactions: result.transactions,
            actualAmount: actualPayout,
            expectedAmount: estimate.jettonToReceive
        }
    }

    private static getActualPayout(transactions: BlockchainTransaction[], pool: Address,
        payoutWallet: Address
    ): bigint {
        for (const tx of transactions) {
            if (tx.description.type !== "generic")
                continue;
            const msg = tx.inMessage;
            if (!msg || msg.info.type !== "internal" || !msg.info.src.equals(pool))
                continue;
            const body = msg.body.beginParse();
            const op = body.loadUint(32);
            if (op !== 0xf93bb43f)
                continue;
            const coinsData = body.loadRef().beginParse();
            const amountLeft = coinsData.loadCoins();
            const walletLeft = coinsData.loadAddress();
            if (walletLeft.equals(payoutWallet))
                return amountLeft;
            const amountRight = coinsData.loadCoins();
            const walletRight = coinsData.loadAddress();
            if (!walletRight.equals(payoutWallet))
                throw new Error("Pool is inconsistent");
            return amountRight;
        }
        return 0n;
    }
}