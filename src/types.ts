import { Address, Cell } from "@ton/core";

export const enum Risk {
    LOW,
    MEDIUM,
    HIGH,
    DANGER,
    UNKNOWN
}

export interface Step {
    title: string;
    description: string;
    risk: Risk;
}

export interface JettonInfo {
    address: Address;
    name: string;
    symbol: string;
    decimals: number;
    admin: Address | null;
    supply: bigint;
    walletCode: Cell;
}