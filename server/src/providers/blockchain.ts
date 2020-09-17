import Web3 from 'web3'
import moment from 'moment'
import { uniqBy, toLower } from 'lodash'
import GoodDollarABI from '@gooddollar/goodcontracts/build/contracts/GoodDollar.json'
import OneTimePaymentsABI from '@gooddollar/goodcontracts/build/contracts/OneTimePayments.min.json'
import UBIABI from '@gooddollar/goodcontracts/stakingModel/build/contracts/UBIScheme.min.json'
import ContractsAddress from '@gooddollar/goodcontracts/releases/deployment.json'
import ContractsModelAddress from '@gooddollar/goodcontracts/stakingModel/releases/deployment.json'

import conf from '../config'
import logger from '../helpers/pino-logger'
import get from 'lodash/get'
import _invert from 'lodash/invert'
import { memoize } from 'lodash'
import walletsProvider from './wallets'
import surveyProvider from './survey'
import surveyDB from '../gun/models/survey'
import AboutTransactionProvider from './about-transaction'
import AboutClaimTransactionProvider from './about-claim-transactions'
import AddressesClaimedProvider from './addresses-claimed'
import PropertyProvider from './property'
import Amplitude from './amplitude'

import * as web3Utils from 'web3-utils'
const log = logger.child({ from: 'Blockchain' })

/**
 * Exported as blockchain
 * Interface with blockchain contracts via web3 using HDWalletProvider
 */
export class blockchain {
  web3: any

  mainNetWeb3: any

  wallet: any

  ready: any

  tokenContract: any

  mainNetTokenContract: any

  ubiContract: any

  bonusContract: any

  otplContract: any

  lastBlock: number

  listPrivateAddress: any

  paymentLinkContracts: any

  network: string

  networkMainnet: string

  networkId: number

  networkIdMainnet: number

  amplitude: Amplitude

  constructor() {
    this.lastBlock = 0
    this.network = conf.network
    this.networkMainnet = conf.networkMainnet
    this.networkId = conf.ethereum.network_id
    this.networkIdMainnet = conf.ethereumMainnet.network_id
    let systemAccounts = Object.values(get(ContractsAddress, `${this.network}`))
      .concat(Object.values(get(ContractsModelAddress, `${this.network}`)))
      .filter((_) => typeof _ === 'string')
      .concat(conf.systemAccounts, ['0x0000000000000000000000000000000000000000'])
      .map((x) => (x as string).toLowerCase())
    this.listPrivateAddress = _invert(Object.assign(systemAccounts))
    this.paymentLinkContracts = get(ContractsAddress, `${this.network}.OneTimePayments`)
    this.amplitude = new Amplitude()
    this.ready = this.init()
    log.info('Starting blockchain reader:', {
      network: this.network,
      mainNetwork: this.networkMainnet,
      networkdId: this.networkId,
      networkdIdMainNet: this.networkIdMainnet,
      systemContracts: this.listPrivateAddress,
    })
  }

  /**
   * Return transport provider for web3 connection
   *
   * @param {boolean} mainnet - determines whether to get regular or mainnet transport provider
   */
  getWeb3TransportProvider(mainnet?: boolean): any {
    const confKey = mainnet ? 'ethereumMainnet' : 'ethereum'
    const transport = get(conf, `[${confKey}].web3Transport`)
    let provider: string
    let web3Provider: any

    switch (transport) {
      case 'WebSocket':
        provider = get(conf, `[${confKey}].websocketWeb3Provider`)
        web3Provider = new Web3.providers.WebsocketProvider(provider)
        break

      case 'HttpProvider':
        provider = get(conf, `[${confKey}].httpWeb3Provider`)
        web3Provider = new Web3.providers.HttpProvider(provider)
        break

      default:
        provider = get(conf, `[${confKey}].httpWeb3Provider`)
        web3Provider = new Web3.providers.HttpProvider(provider)
        break
    }

    log.info({ transport, provider })

    return web3Provider
  }

  getBlock = memoize((blockNumber) => this.web3.eth.getBlock(blockNumber))

  /**
   * Initializing web3 instances and all required contracts
   */
  async init() {
    const { reset } = conf
    const lastVersion = await PropertyProvider.get<number>('lastVersion', 0)

    log.info('LastVersion value:', {
      lastVersion,
      reset,
    })

    if (reset > 0 && reset != lastVersion) {
      log.info('reseting database', { version: reset, lastVersion })

      await Promise.all([
        PropertyProvider.model.deleteMany({}),
        walletsProvider.model.deleteMany({}),
        AboutClaimTransactionProvider.model.deleteMany({}),
        AboutTransactionProvider.model.deleteMany({}),
        AddressesClaimedProvider.model.deleteMany({}),
      ])

      await PropertyProvider.set('lastVersion', reset)
    }

    log.info('Initializing blockchain:', {
      ethereum: conf.ethereum,
      mainnet: conf.ethereumMainnet,
    })

    this.lastBlock = await PropertyProvider.get<number>('lastBlock', 0).catch(() => 0)
    this.lastBlock = this.lastBlock > 0 ? this.lastBlock : 5000000 //TODO:temp fix
    log.info('Fetched last block:', {
      lastBlock: this.lastBlock,
    })

    this.web3 = new Web3(this.getWeb3TransportProvider())
    this.mainNetWeb3 = new Web3(this.getWeb3TransportProvider(true))

    const address: any = get(ContractsAddress, `${this.network}.GoodDollar`)
    const mainNetAddress: any = get(ContractsAddress, `${this.networkMainnet}.GoodDollar`)

    this.tokenContract = new this.web3.eth.Contract(GoodDollarABI.abi, address)
    this.mainNetTokenContract = new this.mainNetWeb3.eth.Contract(GoodDollarABI.abi, mainNetAddress)
    this.ubiContract = new this.web3.eth.Contract(UBIABI.abi, get(ContractsModelAddress, `${this.network}.UBIScheme`))
    this.otplContract = new this.web3.eth.Contract(
      OneTimePaymentsABI.abi,
      get(ContractsAddress, `${this.network}.OneTimePayments`)
    )

    log.info('blockchain Ready:', {
      networkId: this.networkId,
      networkIdMainNet: this.networkIdMainnet,
    })

    return true
  }

  /**
   * Get true if not private wallet
   * @param wallet
   */
  isClientWallet(wallet: string) {
    return this.listPrivateAddress[wallet.toLowerCase()] === undefined
  }

  /**
   * Get true if wallet is paymentlink contracts
   * @param wallet
   */
  isPaymentlinkContracts(wallet: string) {
    return this.web3.utils.toChecksumAddress(this.paymentLinkContracts) === this.web3.utils.toChecksumAddress(wallet)
  }

  /**
   * Update all date BChain
   */
  async updateData() {
    await this.ready
    await this.updateEvents()

    const oneTimePaymentLinksAddress: any = get(ContractsAddress, `${this.network}.OneTimePayments`)
    const inEscrow = await this.tokenContract.methods.balanceOf(oneTimePaymentLinksAddress).call()

    log.debug('update property inEscrow with:', inEscrow)

    await PropertyProvider.set('inEscrow', +inEscrow)

    log.debug('updateData finished')
  }

  async updateEvents() {
    const blockNumber = await this.web3.eth.getBlockNumber().then(Number)

    log.debug('Update events starting:', { from: this.lastBlock, to: blockNumber })

    await Promise.all([
      this.updateListWalletsAndTransactions(blockNumber).catch((e) =>
        log.error('transfer events failed', e.message, e)
      ),
      this.updateClaimEvents(blockNumber).catch((e) => log.error('claim events failed', e.message, e)),
      this.updateOTPLEvents(blockNumber).catch((e) => log.error('otpl events failed', e.message, e)),
      this.updateSupplyAmount().catch((e) => log.error('supply amount update failed', e.message, e)),
      this.updateUBIQuota(blockNumber).catch((e) => log.error('UBI calculations update failed', e.message, e)),
    ])

    log.debug('all promises resolved')

    this.lastBlock = blockNumber
    await PropertyProvider.set('lastBlock', blockNumber)

    log.debug('lastBlock updated:', blockNumber)

    await this.amplitude.sendBatch()

    logger.debug('updateEvents finished')
  }

  async updateUBIQuota(toBlock: number) {
    // Check if the hole history of 'UBICalculated' event is uploaded
    // if not - then set from block to 0 value (beginning)
    const isInitialUBICalcFetched = await PropertyProvider.get<boolean>('isInitialUBICalcFetched', false)
    const lastBlock = isInitialUBICalcFetched ? this.lastBlock : 0
    const allEvents = await this.ubiContract.getPastEvents('UBICalculated', {
      fromBlock: lastBlock > 0 ? lastBlock : 0,
      toBlock,
    })
    const preparedToSave: any = {}

    log.debug('updateUBIQuota started:', {
      events: allEvents.length,
      isInitialUBICalcFetched,
    })

    let firstBlockDate
    for (let index in allEvents) {
      const event = allEvents[index]
      const blockNumber = event.blockNumber

      if (firstBlockDate === undefined || blockNumber - firstBlockDate.blockNumber > 1000) { //estimate block time to save slow network calls
        const txTime = (await this.getBlock(blockNumber)).timestamp
        firstBlockDate = {
          blockNumber,
          txTime,
        }
      }
      //hack for quicker time getting of block
      let timestamp = firstBlockDate.txTime + (blockNumber - firstBlockDate.blockNumber) * 5

      const date = moment.unix(timestamp).format('YYYY-MM-DD')
      const ubiQuotaHex = get(event, 'returnValues.dailyUbi')
      const ubi_quota = web3Utils.hexToNumber(ubiQuotaHex)

      preparedToSave[date] = {
        date,
        ubi_quota,
      }
    }

    log.debug('updateUBIQuota - events data parsed:', {
      preparedToSave: Object.keys(preparedToSave).length,
    })

    await AboutClaimTransactionProvider.updateOrSet(preparedToSave)

    if (!isInitialUBICalcFetched) {
      await PropertyProvider.set('isInitialUBICalcFetched', true)
    }

    log.debug('updateUBIQuota finished')
  }

  async updateWalletsBalance(customWallets: any) {
    const wallets = customWallets && customWallets.length ? customWallets : await walletsProvider.getAll()
    let newBalanceWallets: any = {}

    log.debug('updateWalletsBalance started', { wallets: wallets.length })

    for (let i in wallets) {
      // @ts-ignore
      const address = wallets[i].address
      newBalanceWallets[address] = {
        address,
        balance: await this.getAddressBalance(address),
      }
    }

    await walletsProvider.updateOrSet(newBalanceWallets)

    log.debug('updateWalletsBalance finished')
  }

  async updateBonusEvents(toBlock: number) {
    const allEvents = await this.bonusContract.getPastEvents('BonusClaimed', {
      fromBlock: +this.lastBlock > 0 ? +this.lastBlock : 0,
      toBlock,
    })

    log.info('got Bonus events:', allEvents.length)

    let firstBlockDate
    for (let index in allEvents) {
      let event = allEvents[index]
      let toAddr = event.returnValues.account
      let blockNumber = event.blockNumber

      if (firstBlockDate === undefined || blockNumber - firstBlockDate.blockNumber > 1000) { //estimate block time to save slow network calls
        const txTime = (await this.getBlock(blockNumber)).timestamp
        firstBlockDate = {
          blockNumber,
          txTime,
        }
      }
      //hack for quicker time getting of block
      let txTime = firstBlockDate.txTime + (blockNumber - firstBlockDate.blockNumber) * 5

      if (+txTime < +conf.startTimeTransaction) {
        continue
      }

      const amountTX = web3Utils.hexToNumber(event.returnValues.amount)

      this.amplitude.logEvent({
        user_id: toAddr,
        insert_id: event.transactionHash + '_' + event.logIndex,
        event_type: 'FUSE_BONUS',
        time: txTime,
        event_properties: {
          toAddr,
          value: amountTX / 100,
          isToSystem: this.isClientWallet(toAddr) === false,
        },
      })
    }
  }

  /*
   * Checking if provided addresses did claim at least once
   * if not - increment total unique claimers value
   *
   * @param {string} address - the address to be checked
   *
   * @return {Promise<void>}
   */
  async checkAddressesClaimed(arrayOfAddresses: string[]): Promise<void> {
    // check multiple addresses exists and create new records in case if not exist by one db query
    const { nonExistedCount } = await AddressesClaimedProvider.checkIfExistsMultiple(arrayOfAddresses)
    log.info('new claimers:', { nonExistedCount, outof: arrayOfAddresses.length })
    // if there is some not existed addresses then increment total unique claimers
    if (nonExistedCount) {
      await PropertyProvider.increment('totalUniqueClaimers', nonExistedCount)
    }
  }

  async updateClaimEvents(toBlock: number) {
    const allEvents = await this.ubiContract.getPastEvents('UBIClaimed', {
      fromBlock: +this.lastBlock > 0 ? +this.lastBlock : 0,
      toBlock,
    })

    const aboutClaimTXs: any = {}
    const allAddresses: string[] = []
    let totalUBIDistributed: number = 0

    log.info('updateClaimEvents got Claim events:', { toBlock, fromBlock: this.lastBlock, events: allEvents.length })

    let firstBlockDate
    for (let index in allEvents) {
      let event = allEvents[index]
      let blockNumber = event.blockNumber

      if (firstBlockDate === undefined || blockNumber - firstBlockDate.blockNumber > 1000) { //estimate block time to save slow network calls
        const txTime = (await this.getBlock(blockNumber)).timestamp
        firstBlockDate = {
          blockNumber,
          txTime,
        }
      }
      //hack for quicker time getting of block
      let txTime = firstBlockDate.txTime + (blockNumber - firstBlockDate.blockNumber) * 5

      if (+txTime < +conf.startTimeTransaction) {
        continue
      }

      const amountTX = web3Utils.hexToNumber(event.returnValues.amount)
      totalUBIDistributed += amountTX

      let timestamp = moment.unix(txTime)
      let date = timestamp.format('YYYY-MM-DD')

      if (aboutClaimTXs.hasOwnProperty(date)) {
        aboutClaimTXs[date].total_amount_txs += amountTX
        aboutClaimTXs[date].count_txs += 1
      } else {
        aboutClaimTXs[date] = {
          date,
          total_amount_txs: amountTX,
          count_txs: 1,
        }
      }

      let toAddr = event.returnValues.claimer
      allAddresses.push(toAddr)

      const logPayload = {
        user_id: toAddr,
        insert_id: event.transactionHash + '_' + event.logIndex,
        event_type: 'FUSE_CLAIM',
        time: txTime,
        event_properties: {
          toAddr,
          value: amountTX / 100,
          isToSystem: this.isClientWallet(toAddr) === false,
        },
      }

      log.debug('Claim Event:', index, logPayload)

      this.amplitude.logEvent(logPayload)
    }

    log.debug('updateClaimEvents - events data parsed', {
      totalUBIDistributed,
      aboutClaimTXs,
      addresses: allAddresses.length,
    })

    if (totalUBIDistributed) {
      await PropertyProvider.increment('totalUBIDistributed', totalUBIDistributed)
    }

    if (allAddresses.length) {
      // there could be duplicates, so need to get unique values
      const uniqueAddresses = uniqBy(allAddresses, toLower)

      await this.checkAddressesClaimed(uniqueAddresses)
      await this.updateWalletsBalance(uniqueAddresses.map((address: string) => ({ address })))
    }

    if (Object.keys(aboutClaimTXs).length) {
      await AboutClaimTransactionProvider.updateOrSetInc(aboutClaimTXs)
    }

    log.debug('updateClaimEvents finished')
  }

  async updateOTPLEvents(toBlock: number) {
    const allEvents = await this.otplContract.getPastEvents('allEvents', {
      fromBlock: +this.lastBlock > 0 ? +this.lastBlock : 0,
      toBlock,
    })

    log.debug('updateOTPLEvents - got OTPL events:', allEvents.length)

    let firstBlockDate
    for (let index in allEvents) {
      let event = allEvents[index]
      let fromAddr = event.returnValues.from
      let toAddr = event.returnValues.to
      let blockNumber = event.blockNumber

      if (firstBlockDate === undefined || blockNumber - firstBlockDate.blockNumber > 1000) { //estimate block time to save slow network calls
        const txTime = (await this.getBlock(blockNumber)).timestamp
        firstBlockDate = {
          blockNumber,
          txTime,
        }
      }

      //hack for quicker time getting of block
      let txTime = firstBlockDate.txTime + (blockNumber - firstBlockDate.blockNumber) * 5

      if (+txTime < +conf.startTimeTransaction) {
        continue
      }

      const amountTX = web3Utils.hexToNumber(event.returnValues.amount)

      this.amplitude.logEvent({
        user_id: toAddr ? toAddr : fromAddr,
        insert_id: event.transactionHash + '_' + event.logIndex,
        event_type: 'FUSE_' + event.event,
        time: txTime,
        event_properties: {
          fromAddr,
          toAddr,
          value: amountTX / 100,
          isFromSystem: fromAddr && this.isClientWallet(fromAddr) === false,
          isToSystem: toAddr && this.isClientWallet(toAddr) === false,
        },
      })
    }

    log.debug('updateOTPLEvents finished')
  }

  async updateSupplyAmount() {
    const date = moment().format('YYYY-MM-DD')
    let amount = 0

    try {
      amount = await this.mainNetTokenContract.methods
        .totalSupply()
        .call()
        .then((totals: any) => {
          if (!web3Utils.isBigNumber(totals)) {
            throw new Error('Contract method returned invalid value')
          }

          return totals.toNumber()
        })
    } catch (e) {
      logger.error('Fetch total supply amount failed', e.message, e)
      return
    }

    log.info('updateSupplyAmount - got amount of G$ supply:', {
      amount,
      date,
    })

    const listOfTransactionsData = {
      [date]: {
        date,
        supply_amount: Number(amount),
      },
    }

    await AboutClaimTransactionProvider.updateOrSet(listOfTransactionsData)

    log.debug('updateSupplyAmount finished')
  }

  async updateSurvey() {
    let timestamp = moment.unix(conf.startTimeTransaction)
    let startDate = timestamp.format('YYYY-MM-DD')
    let lastDate = await PropertyProvider.get('lastSurveyDate')
      .then((date) => {
        if (!date) {
          return startDate
        } else {
          return date
        }
      })
      .catch((_) => startDate)

    let from = new Date(lastDate)
    let to = new Date()

    for (; from <= to; ) {
      const surveys = await surveyDB.getByDate(from)
      await surveyProvider.updateOrSet(surveys)
      from.setDate(from.getDate() + 1)
    }

    let lastSurveyDate: string = moment(to).format('YYYY-MM-DD')
    await PropertyProvider.set('lastSurveyDate', lastSurveyDate)
  }
  /**
   * Update list wallets and transactions info
   */
  async updateListWalletsAndTransactions(toBlock: number) {
    let wallets: any = {}
    let aboutTXs: any = {}
    let lastBlock = this.lastBlock
    let totalGDVolume: number = 0

    log.debug('updateListWalletsAndTransactions started:', lastBlock)

    const allEvents = await this.tokenContract.getPastEvents('Transfer', {
      fromBlock: +lastBlock > 0 ? +lastBlock : 0,
      toBlock,
    })

    log.info('updateListWalletsAndTransactions - got Transfer events:', allEvents.length)

    let firstBlockDate
    for (let index in allEvents) {
      let event = allEvents[index]
      let fromAddr = event.returnValues.from
      let toAddr = event.returnValues.to
      let blockNumber = event.blockNumber

      if (firstBlockDate === undefined || blockNumber - firstBlockDate.blockNumber > 1000) { //estimate block time to save slow network calls
        const txTime = (await this.getBlock(blockNumber)).timestamp
        firstBlockDate = {
          blockNumber,
          txTime,
        }
      }
      //hack for quicker time getting of block
      let txTime = firstBlockDate.txTime + (blockNumber - firstBlockDate.blockNumber) * 5

      if (+txTime < +conf.startTimeTransaction) {
        continue
      }

      const amountTX = web3Utils.hexToNumber(event.returnValues.value)
      totalGDVolume += amountTX

      this.amplitude.logEvent({
        user_id: fromAddr,
        insert_id: event.transactionHash + '_' + event.logIndex,
        event_type: 'FUSE_TRANSFER',
        time: txTime,
        event_properties: {
          fromAddr,
          toAddr,
          value: amountTX / 100,
          isFromSystem: this.isClientWallet(fromAddr) === false,
          isToSystem: this.isClientWallet(toAddr) === false,
        },
      })

      // log.debug("Event:", { fromAddr, toAddr, event });

      if (this.isClientWallet(fromAddr)) {
        let timestamp = moment.unix(txTime)
        let date = timestamp.format('YYYY-MM-DD')
        // log.debug('Client Event:', { date, fromAddr, toAddr })

        if (aboutTXs.hasOwnProperty(date)) {
          aboutTXs[date].amount_txs += amountTX
          aboutTXs[date].count_txs += 1
          aboutTXs[date].unique_txs[fromAddr] = true
        } else {
          aboutTXs[date] = {
            date,
            amount_txs: amountTX,
            count_txs: 1,
            unique_txs: { [fromAddr]: true },
          }
        }

        if (wallets.hasOwnProperty(fromAddr)) {
          wallets[fromAddr].outTXs += 1
          wallets[fromAddr].countTx += 1
        } else {
          wallets[fromAddr] = {
            address: fromAddr,
            outTXs: 1,
            inTXs: 0,
            balance: await this.getAddressBalance(fromAddr),
            countTx: 1,
          }
        }
      } else {
        log.trace('Skipping system contracts event', { fromAddr })
      }

      if (this.isClientWallet(toAddr) && (this.isClientWallet(fromAddr) || this.isPaymentlinkContracts(fromAddr))) {
        if (wallets.hasOwnProperty(toAddr)) {
          wallets[toAddr].inTXs += 1
          wallets[toAddr].countTx += 1
        } else {
          wallets[toAddr] = {
            address: toAddr,
            outTXs: 0,
            inTXs: 1,
            countTx: 1,
            balance: await this.getAddressBalance(toAddr),
          }
        }
      }
    }

    log.debug('updateListWalletsAndTransactions - events data parsed:', {
      totalGDVolume,
      wallets,
      aboutTXs,
    })

    if (totalGDVolume) {
      await PropertyProvider.increment('totalGDVolume', totalGDVolume)
    }

    await walletsProvider.updateOrSet(wallets)
    await AboutTransactionProvider.updateOrSet(aboutTXs)

    log.debug('updateListWalletsAndTransactions finished')
  }

  /**
   *  Get GD balance by address
   * @param {string} address
   */
  async getAddressBalance(address: string): Promise<number> {
    const gdbalance = await this.tokenContract.methods.balanceOf(address).call()

    return gdbalance ? web3Utils.hexToNumber(gdbalance) : 0
  }
}

const Blockchain = new blockchain()

export default Blockchain
