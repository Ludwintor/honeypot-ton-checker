const wallets = [
    Buffer.from("vrBoPr64kn/p/I7AoYvH3ReJlomCWhIeq0bFo6hg0M4=", "base64"), // standard jetton wallet v1
    Buffer.from("jSjqQht36AX+pSrPM1KWSZ8Drsjp/SHdtfJWSqZcSN4=", "base64"), // standard jetton wallet v2
    Buffer.from("iUaPAseOVwgC45l5yFFvw43wfqdqSDV+BTbyuns+43s=", "base64"), // governed jetton wallet (USDT)
    Buffer.from("p2DWKdU0PnbQRQF9ncIW/IoweoN3gV/rKwpcSQ5zNIY=", "base64"), // jetton wallet from discoverable
]

/**
 * @deprecated there are many master contracts with different hardcoded gas calculations
 * so no point to checking for "well-known" master contracts. 
 * in any case, the master code does not affect the execution of jetton operations, unlike the code of jetton wallet
 */
export function isKnownMaster(_hash: Buffer) {
    return true;
}

export function isKnownWallet(hash: Buffer) {
    return wallets.some(wallet => wallet.equals(hash));
}