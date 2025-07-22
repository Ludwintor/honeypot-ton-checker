import { Blockchain, BlockchainTransaction, SandboxContract, TreasuryContract } from "@ton/sandbox";
import { Address, toNano } from "@ton/core";
import { PoolV2, PtonV2, RouterV2 } from "../stonfi";
import { addLibs, createJettonTransferBody, getJettonBalance, getJettonWallet } from "./simulation-utils";
import { Simulation, StageSimulationInfo } from "./simulation";
import { divCeil } from "../utils";
import { libs } from "./stonfiV2-libs";

const FEE_DIVIDER = 10000n;
const FORWARD_FEE = toNano(0.25);

const pton = new PtonV2(Address.parse("EQBnGWMCf3-FZZq1W4IWcWiGAc3PHuZ0_H-7sad2oY00o83S"));

export class StonfiV2Simulation extends Simulation {
    private readonly router: RouterV2;
    private readonly walletIn: Address;
    private readonly walletOut: Address;
    private readonly pool: SandboxContract<PoolV2>;
    private readonly amountIn: bigint;

    private constructor(chain: Blockchain, master: Address, router: RouterV2, walletIn: Address,
        walletOut: Address, pool: SandboxContract<PoolV2>, amountIn: bigint
    ) {
        super(chain, master);
        this.router = router
        this.walletIn = walletIn;
        this.walletOut = walletOut;
        this.pool = pool;
        this.amountIn = amountIn;
    }

    public static async create(chain: Blockchain, master: Address, pool: Address, amountIn: bigint): Promise<StonfiV2Simulation> {
        addLibs(chain, libs);
        const poolContract = chain.openContract(new PoolV2(pool));
        const poolData = await poolContract.getPoolData();
        const router = new RouterV2(poolData.routerAddress);
        const walletIn = await getJettonWallet(chain, router.address, pton.address);
        const walletOut = await getJettonWallet(chain, router.address, master);
        return new StonfiV2Simulation(chain, master, router, walletIn, 
            walletOut, poolContract, amountIn
        );
    }

    protected async simulateBuy(treasury: SandboxContract<TreasuryContract>, jettonWallet: Address): Promise<StageSimulationInfo | null> {
        const estimate = await this.getEstimateOutput(this.amountIn, this.walletIn);

        const swapPayload = await this.router.createSwapBody({
            askJettonWalletAddress: this.walletOut,
            receiverAddress: treasury.address,
            minAskAmount: 1n,
            refundAddress: treasury.address
        });

        const result = await treasury.send({
            to: this.walletIn,
            value: this.amountIn + FORWARD_FEE,
            body: await pton.createTonTransferBody({
                tonAmount: this.amountIn,
                refundAddress: treasury.address,
                forwardPayload: swapPayload
            })
        });
        const actualBalance = await getJettonBalance(this.chain, jettonWallet);
        return {
            transactions: result.transactions,
            actualAmount: actualBalance,
            expectedAmount: estimate
        }
    }

    protected async simulateSell(treasury: SandboxContract<TreasuryContract>, jettonWallet: Address): Promise<StageSimulationInfo | null> {
        const balance = await getJettonBalance(this.chain, jettonWallet);
        const estimate = await this.getEstimateOutput(balance, this.walletOut);

        const swapPayload = await this.router.createSwapBody({
            askJettonWalletAddress: this.walletIn,
            receiverAddress: treasury.address,
            minAskAmount: 0n,
            refundAddress: treasury.address
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
        const actualPayout = StonfiV2Simulation.getActualPayout(result.transactions, 
            this.pool.address, this.walletIn
        );
        return {
            transactions: result.transactions,
            actualAmount: actualPayout,
            expectedAmount: estimate
        }
    }

    private async getEstimateOutput(amount: bigint, jettonWallet: Address): Promise<bigint> {
        const data = await this.pool.getPoolData();
        let out = 0n;
        if (jettonWallet.equals(data.token0WalletAddress))
            out = StonfiV2Simulation.getConstantProductOut(amount, data.reserve0, data.reserve1, data.lpFee, data.protocolFee);
        else if (jettonWallet.equals(data.token1WalletAddress))
            out = StonfiV2Simulation.getConstantProductOut(amount, data.reserve1, data.reserve0, data.lpFee, data.protocolFee);
        return out;
    }

    // https://github.com/ston-fi/dex-core/blob/6ab5b1cb3ddb6a37a070f980bae84acbb0197814/contracts/pool/amm.func
    private static getConstantProductOut(amount: bigint, reserveIn: bigint, reserveOut: bigint, 
        lpFee: bigint, protocolFee: bigint
    ): bigint {
        const amountWithFee = amount * (FEE_DIVIDER - lpFee);
        let out = (amountWithFee * reserveOut) / (reserveIn * FEE_DIVIDER + amountWithFee);
        if (protocolFee > 0)
            out -= divCeil(out * protocolFee, FEE_DIVIDER);
        return out;
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
            if (op !== 0x657b54f5)
                continue;
            if (body.remainingRefs > 1)
                body.loadRef(); // skip custom_payload if present
            const data = body.loadRef().beginParse();
            data.loadCoins(); // skip fwd_gas
            const amountLeft = data.loadCoins();
            const walletLeft = data.loadAddress();
            if (walletLeft.equals(payoutWallet))
                return amountLeft;
            const amountRight = data.loadCoins();
            const walletRight = data.loadAddress();
            if (!walletRight.equals(payoutWallet))
                throw new Error("Pool is inconsistent");
            return amountRight;
        }
        return 0n;
    }
}