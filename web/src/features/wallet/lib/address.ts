// Which addresses the wallet workspace can open. The server answers for a transparent `t1` or `t3` address and refuses
// anything else, a ZelID included: a ZelID is a `1...` address that names an operator, not a place nodes are paid to.

/** Base58, `t1` or `t3` first, 35 characters in all: the shape the server accepts before it checks the checksum. */
const WALLET_ADDRESS = /^t[13][1-9A-HJ-NP-Za-km-z]{33}$/;

export function isWalletAddress(text: string | null | undefined): boolean {
  return typeof text === 'string' && WALLET_ADDRESS.test(text);
}
