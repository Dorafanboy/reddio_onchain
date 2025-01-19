import { defineChain } from 'viem';

export interface IBridgeRange {
    readonly minRange: number;
    readonly maxRange: number;
}

export interface IFixedRange extends IBridgeRange {}

export interface IDelayRange extends IBridgeRange {}

export class Config {
    public static readonly isShuffleWallets: boolean = true; // перемешивать ли строки в текстовом файле для приватных ключей
    public static readonly retryCount: number = 3; // сколько попыток будет, чтобы получить новую сеть, значение для бриджа
    public static readonly delayBetweenAction: IDelayRange = {
        minRange: 3,
        maxRange: 5
    }; // задержка между действиями (в секундах) в случае ошибки
    public static readonly delayBetweenAccounts: IDelayRange = { minRange: 5, maxRange: 10 }; // задержка между аккаунтами (в минутах)
    public static readonly delayBetweenModules: IDelayRange = {
        minRange: 1,
        maxRange: 2
    }; // задержка между модулями (в минутах)

    public static readonly rpc: string = 'https://1rpc.io/sepolia';
    public static readonly rpcReddio: string = 'https://reddio-dev.reddio.com';
    public static readonly bridgeETHRange: { range: IBridgeRange; fixed: IFixedRange } = {
        range: { minRange: 0.0001, maxRange: 0.0001 },
        fixed: { minRange: 4, maxRange: 5 }
    }; // сколько ETH бриджить из Sepolia -> Reddio
    public static readonly withdrawETHRange: { range: IBridgeRange; fixed: IFixedRange } = {
        range: { minRange: 0.005, maxRange: 0.007 },
        fixed: { minRange: 3, maxRange: 5 }
    }; // сколько eth выводить из Reddio
    public static readonly isUseDeposit: boolean = false;
    public static readonly isUseWithdraw: boolean = true;
}

export const reddio = defineChain({
    id: 50341,
    name: 'Reddio',
    network: 'Reddio',
    nativeCurrency: {
        decimals: 18,
        name: 'RED',
        symbol: 'RED',
    },
    rpcUrls: {
        default: {
            http: ['https://reddio-dev.reddio.com'], 
        },
        public: {
            http: ['https://reddio-dev.reddio.com'], 
        },
    },
    blockExplorers: {
        default: { name: 'Explorer', url: 'https://reddio-devnet.l2scan.co/' },
    },
});
