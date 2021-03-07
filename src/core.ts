import { RPC, transformers } from 'ckb-js-toolkit';
import { CHAIN_SPECS } from './constants';
import { Config } from './interfaces';
import { Address, Amount, SUDT, Transaction } from './models';
import { DefaultSigner, Signer } from './signers';
import { Collector } from './collectors';
import {
  SimpleBuilder,
  Builder,
  SimpleSUDTACPBuilder,
  SimpleSUDTBuilder,
} from './builders';
import { Platform, Provider } from './providers';
import { SUDTCollector } from './collectors/sudt-collector';
import { Blake2bHasher } from '.';

export enum ChainID {
  ckb,
  ckb_testnet,
  ckb_dev,
}

/**
 * The default main class of pw-core
 */
export default class PWCore {
  static config: Config;
  static chainId: ChainID;
  static provider: Provider;
  static defaultCollector: Collector | SUDTCollector;

  private readonly _rpc: RPC;

  constructor(nodeUrl: string) {
    this._rpc = new RPC(nodeUrl);
  }

  /**
   * Initialize the environment required by pw-core
   */
  async init(
    provider: Provider,
    defaultCollector: Collector,
    chainId?: ChainID,
    config?: Config
  ): Promise<PWCore> {
    if (chainId) {
      if (!(chainId in ChainID)) {
        throw new Error(`invalid chainId ${chainId}`);
      }
      PWCore.chainId = chainId;
    } else {
      const info = await this.rpc.get_blockchain_info();
      PWCore.chainId = {
        ckb: ChainID.ckb,
        ckb_testnet: ChainID.ckb_testnet,
        ckb_dev: ChainID.ckb_dev,
      }[info.chain];
    }

    if (PWCore.chainId === ChainID.ckb_dev) {
      if (!config) {
        throw new Error('config must be provided for dev chain');
      }
      PWCore.config = config;
    } else {
      // merge customized config to default one
      PWCore.config = {
        ...[CHAIN_SPECS.Lina, CHAIN_SPECS.Aggron][PWCore.chainId],
        ...config,
      };
    }

    if (provider instanceof Provider) {
      PWCore.provider = await provider.init();
    } else {
      throw new Error('provider must be provided');
    }

    if (defaultCollector instanceof Collector) {
      PWCore.defaultCollector = defaultCollector;
    } else {
      throw new Error('defaultCollector must be provided');
    }

    return this;
  }

  /**
   * Return a RPC instance defined in package 'ckb-js-toolkit'
   */
  get rpc(): RPC {
    return this._rpc;
  }

  /**
   * Transfer CKB to any address
   * @param address The receiver's address
   * @param amount The amount of CKB to send
   * @param feeRate The feeRate (Shannon/KB) for this transaction.
   */
  async send(
    address: Address,
    amount: Amount,
    feeRate?: number
  ): Promise<string> {
    const simpleBuilder = new SimpleBuilder(address, amount, feeRate);
    return this.sendTransaction(simpleBuilder);
  }

  /**
   * Send an built transaction or a builder
   * @param toSend
   * @param signer
   */
  async sendTransaction(
    toSend: Transaction | Builder,
    signer?: Signer
  ): Promise<string> {
    const tx = toSend instanceof Builder ? await toSend.build() : toSend;
    tx.validate();

    if (!signer) {
      const hasher =
        // for ckb platform we usually use blake2b as hash function
        PWCore.provider.platform === Platform.ckb
          ? new Blake2bHasher()
          : undefined;
      signer = new DefaultSigner(PWCore.provider, hasher);
    }

    return this.rpc.send_transaction(
      transformers.TransformTransaction(await signer.sign(tx))
    );
  }

  /**
   * Transfer sudt to any address
   * @param sudt The sudt definition
   * @param address the receiver's address
   * @param amount the aount of sudt to send
   * @param feeRate the feeRate (Shannon/CKB) for this transation
   * @returns the transaction hash
   */
  async sendSUDT(
    sudt: SUDT,
    address: Address,
    amount: Amount,
    createAcp?: boolean,
    signer?: Signer,
    feeRate?: number
  ): Promise<string> {
    const builder = createAcp
      ? new SimpleSUDTBuilder(sudt, address, amount, feeRate)
      : new SimpleSUDTACPBuilder(sudt, address, amount, feeRate);

    return this.sendTransaction(builder, signer);
  }
}
