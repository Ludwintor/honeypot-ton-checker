import { Address, beginCell, BitReader, Cell, CellType, Dictionary, SendMode, toNano } from "@ton/core";
import { Blockchain, BlockchainTransaction, printTransactionFees, SandboxContract, TreasuryContract } from "@ton/sandbox";
import { request, gql } from "graphql-request";
import { allTxsOk, calculateLoss, createJettonTransferBody, getJettonBalance, getJettonWallet } from "./simulation-utils";

const DTON_ENDPOINT = "https://dton.io/graphql/";

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
        await this.setupLib();

        let buy: StageResult | null = null;
        let transfer: StageResult | null = null;
        let sell: StageResult | null = null;

        console.log("---BUY STAGE---------------------");
        const buyInfo = await this.simulateBuy(treasury, jettonWallet);
        if (buyInfo !== null) {
            buy = this.processStage(buyInfo);
            console.log("---TRANSFER STAGE---------------------");
            const jettonWalletContract = await this.chain.getContract(jettonWallet);
            const walletSnap = jettonWalletContract.snapshot();
            const transferInfo = await this.simulateTransfer(treasury, jettonWallet);
            jettonWalletContract.loadFrom(walletSnap);
            if (transferInfo !== null) {
                transfer = this.processStage(transferInfo);
                console.log("---SELL STAGE---------------------");
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

    private async setupLib(): Promise<void> {
        const stack = (await this.chain.runGetMethod(this.master, "get_jetton_data")).stack;
        if (stack.length < 5)
            throw new Error("Can't find code in jetton master data");
        const codeItem = stack.at(4);
        if (codeItem?.type !== "cell")
            throw new Error("Can't find code in jetton master data");
        const walletCode = codeItem.cell;

        const key = Dictionary.Keys.Buffer(32);
        const value = Dictionary.Values.Cell();
        const libs = this.chain.libs?.beginParse().loadDictDirect(key, value) ??
            Dictionary.empty(key, value);
        if (walletCode.type == CellType.Library) {
            const br = new BitReader(walletCode.bits);
            br.skip(8);
            const libHash = br.loadBuffer(32);
            if (!libs.has(libHash)) {
                const lib = await getLibrary(libHash);
                libs.set(libHash, lib);
            }
        }
        this.chain.libs = beginCell().storeDictDirect(libs).endCell();
    }

    private processStage(info: StageSimulationInfo): StageResult | null {
        printTransactionFees(info.transactions);
        if (!allTxsOk(info.transactions))
            return null;

        const loss = calculateLoss(info.actualAmount, info.expectedAmount);
        console.log("Actual amount:", info.actualAmount);
        console.log("Expected amount:", info.expectedAmount);
        console.log("Loss:", loss);
        return { loss };
    }
}

async function getLibrary(hash: Buffer): Promise<Cell> {
    const query = gql`
        query {
            get_lib(lib_hash: "${hash.toString("hex").toUpperCase()}")
        }
    `;

    const data = await request(DTON_ENDPOINT, query) as any;
    return Cell.fromBase64(data["get_lib"]);
}