import { Address, beginCell, Cell, Dictionary, Transaction, TupleBuilder } from "@ton/core";
import { Blockchain } from "@ton/sandbox";

const PERCENT_PRECISION = 10000n;

export function calculateLoss(current: bigint, expected: bigint): number {
    if (expected === 0n)
        return 1;
    const ratio = Number(current * PERCENT_PRECISION / expected) / Number(PERCENT_PRECISION);
    return Math.abs(Math.min(ratio, 1) - 1);
}
export function createJettonTransferBody(
    params: {
        amount: bigint,
        destination: Address,
        forwardAmount: bigint,
        payload?: Cell,
        response?: Address
    }
): Cell {
    return beginCell()
        .storeUint(0xf8a7ea5, 32)
        .storeUint(0, 64)
        .storeCoins(params.amount)
        .storeAddress(params.destination)
        .storeAddress(params.response)
        .storeMaybeRef(null)
        .storeCoins(params.forwardAmount)
        .storeMaybeRef(params.payload)
        .endCell()
}

export async function getJettonWallet(chain: Blockchain, owner: Address, master: Address): Promise<Address> {
    const tb = new TupleBuilder();
    tb.writeAddress(owner);
    const result = await chain.runGetMethod(master, "get_wallet_address", tb.build());
    return result.stackReader.readAddress();
}

export async function getJettonBalance(chain: Blockchain, jettonWallet: Address) {
    const result = await chain.runGetMethod(jettonWallet, "get_wallet_data");
    return result.exitCode === 0 ? result.stackReader.readBigNumber() : 0n;
}

const libKey = Dictionary.Keys.Buffer(32);
const libValue = Dictionary.Values.Cell();

export function addLibs(chain: Blockchain, items: LibItem[]) {
    const libs = chain.libs?.beginParse().loadDictDirect(libKey, libValue) ??
        Dictionary.empty(libKey, libValue);
    const prevLength = libs.size;
    for (const item of items)
        if (!libs.has(item.hash))
            libs.set(item.hash, item.code);
    if (prevLength !== libs.size)
        chain.libs = beginCell().storeDictDirect(libs).endCell();
}

// TODO: check action opcodes??
export function allTxsOk(transactions: Transaction[]): boolean {
    for (const tx of transactions) {
        if (tx.description.type !== "generic")
            continue;
        if (tx.description.computePhase.type === "vm" && tx.description.computePhase.exitCode !== 0)
            return false;
    }
    return true;
}

export interface LibItem {
    hash: Buffer;
    code: Cell;
}