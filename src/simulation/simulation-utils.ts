import { Address, beginCell, Cell, Transaction, TupleBuilder } from "@ton/core";
import { Blockchain } from "@ton/sandbox";

const PERCENT_PRECISION = 10000n;

export function difference(current: bigint, expected: bigint): number {
    const ratio = Number(current * PERCENT_PRECISION / expected) / Number(PERCENT_PRECISION);
    return Math.abs(Math.min(ratio, 1) - 1);
}

export function createTransferBody(amount: bigint, dest: Address, resp: Address,
        forwardAmount: bigint, payload: Cell | null): Cell {
    return beginCell()
        .storeUint(0xf8a7ea5, 32)
        .storeUint(0, 64)
        .storeCoins(amount)
        .storeAddress(dest)
        .storeAddress(resp)
        .storeMaybeRef(null)
        .storeCoins(forwardAmount)
        .storeMaybeRef(payload)
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
    return result.stackReader.readBigNumber();
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