import _ from 'lodash'
import networks from './networks'
require('dotenv').config()
const convict = require('convict')
import ContractsAddress from '@gooddollar/goodcontracts/releases/deployment.json'

// Define a schema
const conf = convict({
  env: {
    doc: 'The applicaton environment.',
    format: ['production', 'development', 'staging', 'test'],
    default: 'development',
    arg: 'nodeEnv',
    env: 'NODE_ENV',
  },
  ip: {
    doc: 'The IP address to bind.',
    format: 'ipaddress',
    default: '127.0.0.1',
    env: 'IP_ADDRESS',
  },
  port: {
    doc: 'The port to bind.',
    format: 'port',
    default: 3003,
    env: 'PORT',
  },
  logLevel: {
    doc: 'Log level',
    format: ['debug', 'error', 'warn', 'info', 'off', 'trace'],
    default: 'debug',
    env: 'LOG_LEVEL',
  },
  cronTimeExpression: {
    doc: 'cron time expression - used to determine execution interval',
    format: String,
    default: '*/30 * * * *',
    env: 'CRON_TIME_EXPRESSION',
  },
  cronTimeZone: {
    doc: 'cron interval to refresh data',
    format: String,
    default: 'Asia/Jerusalem',
    env: 'CRON_TIMEZONE',
  },
  startTimeTransaction: {
    doc: 'start time transaction',
    format: Number,
    default: 1573470000,
    env: 'START_TIME_TRANSACTION',
  },
  stepDistributionHistogramWalletBalance: {
    doc: 'step distribution histogram wallet balance',
    format: Number,
    default: 5,
    env: 'STEP_DISTRIBUTION_HISTOGRAM_WALLET_BALANCE',
  },
  gunPublicUrl: {
    doc: 'step distribution histogram wallet balance',
    format: Number,
    default: 'http://localhost:8765/gun',
    env: 'GUN_PUBLIC_URL'
  },
  stepDistributionHistogramWalletTransaction: {
    doc: 'step distribution histogram wallet transaction',
    format: Number,
    default: 5,
    env: 'STEP_DISTRIBUTION_HISTOGRAM_WALLET_TRANSACTION',
  },
  systemAccounts:{
    doc: 'system accounts address',
    format: Array,
    default: [],
    env: 'SYSTEM_ACCOUNTS',
  },
  ethereum: {
    network_id: 42,
    httpWeb3Provider: 'https://kovan.infura.io/v3/',
    websocketWeb3Provider: 'wss://kovan.infura.io/ws',
    web3Transport: 'HttpProvider',
  },
  network: {
    doc: 'The blockchain network to connect to',
    format: [
      'kovan',
      'mainnet',
      'rinkbey',
      'ropsten',
      'truffle',
      'ganache',
      'fuse',
      'production',
      'develop',
      'staging',
    ],
    default: 'develop',
    env: 'NETWORK',
  },
  mongodb: {
    uri: {
      doc: 'Mongo DB URI',
      format: '*',
      env: 'MONGO_DB_URI',
      default: '',
    },
  },
  amplitudeKey: {
    format: String,
    env: 'AMPLITUDE_KEY',
    default: null,
  },
  fuse: {
    doc: 'Main url for fuse api',
    format: String,
    env: 'FUSE_API',
    default: null,
  },
})

// Load environment dependent configuration
const network = conf.get('network')

conf.set('ethereum', _.get(networks, `[${_.get(ContractsAddress, `[${network}].networkId`)}]`))

export default conf.getProperties()
