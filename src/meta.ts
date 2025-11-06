import { ContractsMeta } from "@ton/sandbox/dist/meta/ContractsMeta";

export const VoidContractsMeta: ContractsMeta = {
    get() { return undefined },
    upsert() {}
}