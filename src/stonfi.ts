// TODO: doesn't know any other way to export classes that haven't exported by stonfi
// tried `export type RouterV1 = typeof DEX.v1.Router` doesn't allow to instantiate class
// and only type can be used in generic, not class (so instance != RouterV1)
//
// tried `export const RouterV1 = DEX.v1.Router` doesn't allow to use it in generics
// doing `<typeof RouterV1>` result in same problem above
//
// if someone have better solution (either better exporting or using DEX.v1.Router for generics without conflicts)
// - feel free to create a PR or issue with explanation so I can do it myself
export { RouterV1 } from "../node_modules/@ston-fi/sdk/dist/contracts/dex/v1/RouterV1";
export { PoolV1 } from "../node_modules/@ston-fi/sdk/dist/contracts/dex/v1/PoolV1";