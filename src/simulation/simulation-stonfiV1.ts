import { Blockchain, BlockchainTransaction, SandboxContract, TreasuryContract } from "@ton/sandbox";
import { Address, Cell, Dictionary, toNano } from "@ton/core";
import { PoolV1, RouterV1 } from "../stonfi";
import { DEX } from "@ston-fi/sdk";
import { createTransferBody, getJettonBalance, getJettonWallet } from "./simulation-utils";
import { Simulation, StageSimulationInfo } from "./simulation";

const pTON = new DEX.v1.pTON();
const FORWARD_FEE = toNano(0.25);

export class StonfiV1Simulation extends Simulation {
    private readonly router: RouterV1;
    private readonly routerPTONWalletIn: Address;
    private readonly routerJettonWalletOut: Address;
    private readonly pool: SandboxContract<PoolV1>;
    private readonly amountIn: bigint;

    private constructor(chain: Blockchain, master: Address, router: RouterV1, routerPTONWalletIn: Address,
        routerJettonWalletOut: Address, pool: SandboxContract<PoolV1>, amountIn: bigint
    ) {
        super(chain, master);
        this.router = router
        this.routerPTONWalletIn = routerPTONWalletIn;
        this.routerJettonWalletOut = routerJettonWalletOut;
        this.pool = pool;
        this.amountIn = amountIn;
    }

    public static async create(chain: Blockchain, master: Address, pool: Address, amountIn: bigint): Promise<StonfiV1Simulation> {
        if ((await chain.getContract(pool)).accountState?.type !== "active")
            throw new Error("Pool is not active");
        const router = new RouterV1();
        const walletIn = await getJettonWallet(chain, router.address, pTON.address);
        const walletOut = await getJettonWallet(chain, router.address, master);
        const poolContract = chain.openContract(PoolV1.create(pool));
        return new StonfiV1Simulation(chain, master, router, walletIn, 
            walletOut, poolContract, amountIn
        );
    }

    protected setupLibs(_libs: Dictionary<Buffer, Cell>): Promise<void> {
        return Promise.resolve();
    }

    protected async simulateBuy(treasury: SandboxContract<TreasuryContract>, jettonWallet: Address): Promise<StageSimulationInfo | null> {
        const estimate = await this.pool.getExpectedOutputs({
            amount: this.amountIn,
            jettonWallet: this.routerPTONWalletIn
        });

        const swapPayload = await this.router.createSwapBody({
            userWalletAddress: treasury.address,
            minAskAmount: 0n,
            askJettonWalletAddress: this.routerJettonWalletOut
        });

        const result = await treasury.send({
            to: this.routerPTONWalletIn,
            value: this.amountIn + FORWARD_FEE,
            body: createTransferBody(
                this.amountIn, this.router.address, null,
                FORWARD_FEE, swapPayload
            )
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
            jettonWallet: this.routerJettonWalletOut
        });

        const swapPayload = await this.router.createSwapBody({
            userWalletAddress: treasury.address,
            minAskAmount: 0n,
            askJettonWalletAddress: this.routerPTONWalletIn
        });

        const result = await treasury.send({
            to: jettonWallet,
            value: toNano(0.06) + FORWARD_FEE,
            body: createTransferBody(
                balance, this.router.address, treasury.address,
                FORWARD_FEE, swapPayload
            )
        });
        const actualPayout = StonfiV1Simulation.getActualPayout(result.transactions, 
            this.pool.address, this.routerPTONWalletIn
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