import { AccountState, Address, beginCell, Cell, CellType, Dictionary } from "@ton/core";
import { Blockchain, BlockchainStorage, RemoteBlockchainStorageClient, SmartContract } from "@ton/sandbox";

const libKey = Dictionary.Keys.Buffer(32);
const libValue = Dictionary.Values.Cell();

export interface LibraryFetcher {
  fetchLibrary(hash: Buffer): Promise<Cell | null>
}

export class RemoteBlockchainAutoLibsStorage implements BlockchainStorage {
  private contracts: Map<string, SmartContract> = new Map()
  private libsCache: Map<string, Cell> = new Map()
  private client: RemoteBlockchainStorageClient
  private fetcher: LibraryFetcher
  private blockSeqno?: number

  constructor(client: RemoteBlockchainStorageClient, fetcher: LibraryFetcher, blockSeqno?: number) {
    this.client = client
    this.fetcher = fetcher
    this.blockSeqno = blockSeqno
  }

  async getContract(blockchain: Blockchain, address: Address): Promise<SmartContract> {
    let existing = this.contracts.get(address.toRawString());
    if (!existing) {
      let blockSeqno = this.blockSeqno ?? (await this.client.getLastBlockSeqno())
      let account = await this.client.getAccount(blockSeqno, address);
      const lt = account.lastTransaction?.lt ?? 0n;
      existing = new SmartContract(
        {
          lastTransactionHash: BigInt('0x' + (account.lastTransaction?.hash?.toString('hex') ?? '0')),
          lastTransactionLt: lt,
          account: {
            addr: address,
            storageStats: {
              used: {
                cells: 0n,
                bits: 0n,
              },
              lastPaid: 0,
              duePayment: null,
              storageExtra: null,
            },
            storage: {
              lastTransLt: lt === 0n ? 0n : lt + 1n,
              balance: { coins: account.balance },
              state: account.state,
            },
          },
        },
        blockchain,
      );

      this.contracts.set(address.toRawString(), existing);
      await this.addLib(blockchain, account.state)
    }

    return existing;
  }

  knownContracts(): SmartContract[] {
    return Array.from(this.contracts.values())
  }

  clearKnownContracts(): void {
    this.contracts.clear()
  }

  private async addLib(blockchain: Blockchain, state: AccountState) {
    if (state.type !== "active" || !state.state.code)
      return
    const code = state.state.code
    if (code.type !== CellType.Library)
      return
    const libHash = code.beginParse(true).skip(8).loadBuffer(32)
    const libHashHex = libHash.toString("hex")

    const libs = blockchain.libs?.beginParse().loadDictDirect(libKey, libValue) ??
        Dictionary.empty(libKey, libValue)
    if (libs.has(libHash))
      return

    let actualCode = this.libsCache.get(libHashHex)
    if (!actualCode) {
      actualCode = (await this.fetcher.fetchLibrary(libHash)) ?? undefined
      if (!actualCode)
        return
      this.libsCache.set(libHashHex, actualCode)
    }
    libs.set(libHash, actualCode)
    blockchain.libs = beginCell().storeDictDirect(libs).endCell()
  }
}
