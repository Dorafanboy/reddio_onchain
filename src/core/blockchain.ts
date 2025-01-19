import {
    createPublicClient,
    http,
    createWalletClient,
    encodeFunctionData,
    type PublicClient,
    type Hash,
    PrivateKeyAccount,
    Hex,
} from 'viem';
import { Config, reddio } from '../config';
import { formatUnits } from 'viem';
import { printError, printInfo, printSuccess } from '../data/logger/logPrinter';
import { delay } from '../data/helpers/delayer';
import { getSwapBalance, getValue } from '../data/utils/utils';
import { CONTRACT_ABI, CONTRACT_ABI_WITHDRAW } from './abi';
import axios from 'axios';

const BRIDGE_GAS_LIMIT = BigInt(3000000);

const CONTRACT_ADDRESS = '0xA3ED8915aE346bF85E56B6BB6b723091716f58b4';

const REDDIO_ETH: Hex = '0x4f4FDcECa7d48822E39097970b6cDBa179C28d9b'

export async function executeWithdraw(account: PrivateKeyAccount): Promise<boolean> {
    printInfo(`Выполняю вывод ETH`);

    let currentTry: number = 0,
        value;

    let client!: PublicClient;

    while (currentTry <= Config.retryCount) {
        if (currentTry == Config.retryCount) {
            printError(
                `Не удалось получить значение для вывода. Превышено количество попыток - [${currentTry}/${Config.retryCount}]\n`
            );
            return false;
        }

        client = createPublicClient({
            chain: reddio,
            transport: http(Config.rpcReddio)
        });

        printInfo(`Пытаюсь рассчитать сумму вывода ETH`);

        const reddioEthBalance = await getSwapBalance(client, account.address, REDDIO_ETH);

        value = await getValue(
            client,
            account.address,
            Config.withdrawETHRange.range,
            Config.withdrawETHRange.fixed,
            true,
        reddioEthBalance
        );

        currentTry++;

        if (value != null && value != BigInt(-1)) {
            currentTry = Config.retryCount + 1;
        } else {
            await delay(Config.delayBetweenAction.minRange * 1000, Config.delayBetweenAction.maxRange * 1000, false);
        }
    }

    if (!value) return false;

    const walletClient = createWalletClient({
        chain: reddio,
        transport: http(Config.rpcReddio)
    });

    try {
        printInfo(`Произвожу Withdraw ETH Reddio на ${formatUnits(value!, 18)} ETH`);

        const nonce = await client.getTransactionCount({ address: account.address });
        
        const data = encodeFunctionData({
            abi: CONTRACT_ABI_WITHDRAW,
            functionName: 'withdrawETH',
            args: [account.address, value],
        });
        
        const preparedTransaction = await walletClient
            .prepareTransactionRequest({
                account,
                to: CONTRACT_ADDRESS,
                data: data,
                nonce: nonce,
            })
            .catch((e: Error) => {
                printError(`Произошла ошибка во время подготовки транзакции - ${e}`);
                return undefined;
            });

        if (preparedTransaction != undefined) {
            const signature = await walletClient.signTransaction(preparedTransaction).catch((e: Error) => {
                printError(`Произошла ошибка во время подписания транзакции - ${e}`);
                return undefined;
            });

            if (signature !== undefined) {
                const hash = await walletClient.sendRawTransaction({ serializedTransaction: signature }).catch((e: Error) => {
                    printError(`Произошла ошибка во время отправки транзакции - ${e}`);
                    return false;
                });

                if (hash == false) {
                    return false;
                }

                const url = `https://reddio-devnet.l2scan.co/tx/${hash}`;

                const transaction = await client
                    .waitForTransactionReceipt({ hash: <`0x${string}`>hash })
                    .then(async (result) => {
                        printSuccess(`Транзакция успешно отправлена. Хэш транзакции: ${url}\n`);
                    })
                    .catch((e: Error) => {
                        printError(`Произошла ошибка во время выполнения модуля - ${e}`);
                        return { request: undefined };
                    });

                await delay(Config.delayBetweenModules.minRange, Config.delayBetweenModules.maxRange, true);
                // @ts-ignore
                await executeClaim(account, hash)

                return true;
            }
        }
        
        return false;

    } catch (error) {
        printError(`Произошла ошибка во время выполнения вывода - ${error}`);
        return false;
    }
}

export async function executeClaim(account: PrivateKeyAccount, txHash: Hash): Promise<boolean> {
    printInfo(`Выполняю Claim ETH`);

    try {
        // Получаем данные о выводе с API
        const response = await axios.post(
            'https://reddio-dev.reddio.com/bridge/withdrawals',
            {
                'address': account.address,
                'page': 1,
                'page_size': 100
            },
            {
                headers: {
                    'accept-language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
                    'origin': 'https://testnet-bridge.reddio.com',
                    'priority': 'u=1, i',
                    'referer': 'https://testnet-bridge.reddio.com/',
                    'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
                    'sec-ch-ua-mobile': '?0',
                    'sec-ch-ua-platform': '"Windows"',
                    'sec-fetch-dest': 'empty',
                    'sec-fetch-mode': 'cors',
                    'sec-fetch-site': 'same-site',
                    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
                }
            }
        );
        
        const withdrawal = response.data.data.results.find(
            (tx: any) => tx.hash.toLowerCase() === txHash.toLowerCase()
        );

        if (!withdrawal) {
            printError(`Транзакция ${txHash} не найдена в списке выводов`);
            return false;
        }

        const {
            message_hash,
            claim_info: {
                from,
                to,
                value,
                message: { nonce },
                proof: { multisign_proof }
            }
        } = withdrawal;

        const client = createPublicClient({
            chain: reddio,
            transport: http(Config.rpcReddio)
        });

        const walletClient = createWalletClient({
            chain: reddio,
            transport: http(Config.rpcReddio)
        });

        const payload = {
            payload_type: 0,
            payload: `000000000000000000000000${from.slice(2)}000000000000000000000000${to.slice(2)}${BigInt(value).toString(16).padStart(64, '0')}`,
            nonce: nonce
        };

        const data = encodeFunctionData({
            abi: CONTRACT_ABI,
            functionName: 'receiveUpwardMessages',
            args: [
                [{
                    payloadType: 0,
                    payload: `0x${payload.payload}`,
                    nonce: BigInt(nonce)
                }],
                [multisign_proof]
            ]
        });

        const gasPrice = await client.getGasPrice();
        const adjustedGasPrice = (gasPrice * BigInt(120)) / BigInt(100);

        const preparedTransaction = await walletClient
            .prepareTransactionRequest({
                account,
                to: CONTRACT_ADDRESS,
                data: data,
                gas: BRIDGE_GAS_LIMIT,
                gasPrice: adjustedGasPrice
            })
            .catch((e: Error) => {
                printError(`Произошла ошибка во время подготовки транзакции - ${e}`);
                return undefined;
            });

        if (preparedTransaction != undefined) {
            const signature = await walletClient.signTransaction(preparedTransaction).catch((e: Error) => {
                printError(`Произошла ошибка во время подписания транзакции - ${e}`);
                return undefined;
            });

            if (signature !== undefined) {
                const hash = await walletClient.sendRawTransaction({ serializedTransaction: signature }).catch((e: Error) => {
                    printError(`Произошла ошибка во время отправки транзакции - ${e}`);
                    return false;
                });

                if (hash == false) {
                    return false;
                }

                const url = `https://reddio-devnet.l2scan.co/tx/${hash}`;

                const transaction = await client
                    .waitForTransactionReceipt({ hash: <`0x${string}`>hash })
                    .then(async (result) => {
                        printSuccess(`Транзакция успешно отправлена. Хэш транзакции: ${url}\n`);
                    })
                    .catch((e: Error) => {
                        printError(`Произошла ошибка во время выполнения модуля - ${e}`);
                        return { request: undefined };
                    });

                return true;
            }
        }

        return false;

    } catch (error) {
        printError(`Произошла ошибка во время выполнения claim - ${error}`);
        return false;
    }
} 