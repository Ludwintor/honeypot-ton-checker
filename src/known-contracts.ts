const masters = [
    Buffer.from("mg+Y3W+/Il7vgWXk5kQX7pMffuoABlNDnntdzcBkTNY=", "base64"), // standard jetton minter v1
    Buffer.from("+D0FSQr3ycxYAZSIx7JTyUktScJdEtCTg+UugVN+NDo=", "base64"), // standard jetton minter v2
    Buffer.from("GNW254D/C7RRJUwsdg0J1uSFY4zRQHq7lweHUsPBye4=", "base64"), // governed jetton minter (USDT)
    Buffer.from("BXGXbGPsG3VQIwomCdvts24bZO+NAioWs06lcGMYWy8=", "base64"), // jetton minter discoverable
]

const wallets = [
    Buffer.from("vrBoPr64kn/p/I7AoYvH3ReJlomCWhIeq0bFo6hg0M4=", "base64"), // standard jetton wallet v1
    Buffer.from("jSjqQht36AX+pSrPM1KWSZ8Drsjp/SHdtfJWSqZcSN4=", "base64"), // standard jetton wallet v2
    Buffer.from("iUaPAseOVwgC45l5yFFvw43wfqdqSDV+BTbyuns+43s=", "base64"), // governed jetton wallet (USDT)
    Buffer.from("p2DWKdU0PnbQRQF9ncIW/IoweoN3gV/rKwpcSQ5zNIY=", "base64"), // jetton wallet from discoverable
]

export function isKnownMaster(hash: Buffer) {
    return masters.some(master => master.equals(hash));
}

export function isKnownWallet(hash: Buffer) {
    return wallets.some(wallet => wallet.equals(hash));
}