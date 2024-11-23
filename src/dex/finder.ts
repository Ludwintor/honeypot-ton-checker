import { TonClient } from "@ton/ton";
import { Address } from "@ton/core";

export const enum Dex {
    DEDUST,
    STONFI_V1,
    STONFI_V2
}

export interface PoolInfo {
    dex: Dex;
    name: string;
    address: Address;
    reservesUsd: number;
}

export abstract class PoolFinder {
    protected readonly client: TonClient;

    protected constructor(client: TonClient) {
        this.client = client;
    }

    public abstract findPools(master: Address): Promise<PoolInfo[]>;
}