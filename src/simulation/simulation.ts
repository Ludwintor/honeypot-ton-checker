import { Address, SendMode, toNano } from "@ton/core";
import { Blockchain, BlockchainTransaction, printTransactionFees, SandboxContract, TreasuryContract } from "@ton/sandbox";
import { calculateLoss, createJettonTransferBody, getJettonBalance, getJettonWallet } from "./simulation-utils";

export interface StageSimulationInfo {
    transactions: BlockchainTransaction[],
    actualAmount: bigint,
    expectedAmount: bigint
}

export interface SimulationResult {
    transfer: StageResult | null;
    buy: StageResult | null;
    sell: StageResult | null;
}

export interface StageResult {
    loss: number // 0..1 precision: 0.0001 (0.01%)
}

export abstract class Simulation {
    protected readonly chain: Blockchain;
    protected readonly master: Address;

    protected constructor(chain: Blockchain, master: Address) {
        this.chain = chain;
        this.master = master;
    }

    public async simulate(): Promise<SimulationResult> {
        const treasury = await this.chain.treasury("simulation");
        console.log("Treasury:", treasury.address.toString());
        const jettonWallet = await getJettonWallet(this.chain, treasury.address, this.master);

        let buy: StageResult | null = null;
        let transfer: StageResult | null = null;
        let sell: StageResult | null = null;

        console.log("---BUY STAGE---------------------");
        this.chain.now ??= Math.floor(Date.now() / 1000)
        const buyInfo = await this.simulateBuy(treasury, jettonWallet);
        if (buyInfo !== null) {
            buy = this.processStage(buyInfo);
            console.log("---TRANSFER STAGE---------------------");
            const jettonWalletContract = await this.chain.getContract(jettonWallet);
            const walletSnap = jettonWalletContract.snapshot();
            this.chain.now += 300
            const transferInfo = await this.simulateTransfer(treasury, jettonWallet);
            jettonWalletContract.loadFrom(walletSnap);
            if (transferInfo !== null) {
                transfer = this.processStage(transferInfo);
                console.log("---SELL STAGE---------------------");
                this.chain.now += 300
                const sellInfo = await this.simulateSell(treasury, jettonWallet);
                if (sellInfo !== null)
                    sell = this.processStage(sellInfo);
            }
        }
        return { buy, transfer, sell };
    }

    /**
     * Simulates jetton buy. Changes persist for next transfer stage
     */
    protected abstract simulateBuy(treasury: SandboxContract<TreasuryContract>, jettonWallet: Address)
        : Promise<StageSimulationInfo | null>;

    /**
     * Simulates jetton transfer. All changes will be reverted at the end of this stage
     * for next sell stage (because we need jettons to simulate sell)
     */
    protected async simulateTransfer(treasury: SandboxContract<TreasuryContract>, jettonWallet: Address)
        : Promise<StageSimulationInfo | null> {
        const another = await this.chain.treasury("another");
        const anotherJettonWallet = await getJettonWallet(this.chain, another.address, this.master);
        const anotherJWContract = await this.chain.getContract(anotherJettonWallet);
        const transferSnap = anotherJWContract.snapshot();
        const sendAmount = await getJettonBalance(this.chain, jettonWallet);
        const result = await treasury.send({
            to: jettonWallet,
            value: toNano(0.06),
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: createJettonTransferBody({
                amount: sendAmount,
                destination: another.address,
                response: treasury.address,
                forwardAmount: 1n
            })
        });

        const balance = await getJettonBalance(this.chain, anotherJettonWallet);
        anotherJWContract.loadFrom(transferSnap);
        return {
            transactions: result.transactions,
            actualAmount: balance,
            expectedAmount: sendAmount
        }
    }

    /**
     * Simulates jetton sell
     */
    protected abstract simulateSell(treasury: SandboxContract<TreasuryContract>, jettonWallet: Address)
        : Promise<StageSimulationInfo | null>;

    private processStage(info: StageSimulationInfo): StageResult | null {
        printTransactionFees(info.transactions);

        const loss = calculateLoss(info.actualAmount, info.expectedAmount);
        console.log("Actual amount:", info.actualAmount);
        console.log("Expected amount:", info.expectedAmount);
        console.log("Loss:", loss);
        return { loss };
    }
}
