import { createPublicClient, http, createWalletClient, encodeFunctionData, type PublicClient, type WalletClient, type Hash, PrivateKeyAccount } from 'viem';
import { sepolia } from 'viem/chains';
import { Config } from '../config';
import { formatUnits } from 'viem';
import { printError, printInfo, printSuccess } from '../data/logger/logPrinter';
import { delay } from '../data/helpers/delayer';
import { getValue } from '../data/utils/utils';
import { CONTRACT_ABI } from './abi';

const BRIDGE_GAS_LIMIT = BigInt(3000000);

const CONTRACT_ADDRESS = '0xB74D5Dba3081bCaDb5D4e1CC77Cc4807E1c4ecf8';

export async function executeDeposit(account: PrivateKeyAccount): Promise<boolean> {
    printInfo(`Выполняю депозит ETH`);

    let currentTry: number = 0,
        value;

    let client!: PublicClient;

    while (currentTry <= Config.retryCount) {
        if (currentTry == Config.retryCount) {
            printError(
                `Не удалось получить значение для депозита. Превышено количество попыток - [${currentTry}/${Config.retryCount}]\n`
            );
            return false;
        }

        client = createPublicClient({
            chain: sepolia,
            transport: http(Config.rpc)
        });

        printInfo(`Пытаюсь рассчитать сумму депозита`);

        value = await getValue(
            client,
            account.address,
            Config.bridgeETHRange.range,
            Config.bridgeETHRange.fixed,
            true
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
        chain: sepolia,
        transport: http(Config.rpc)
    });

    try {
        printInfo(`Произвожу Deposit ETH -> Reddio на ${formatUnits(value!, 18)} ETH`);

        const nonce = await client.getTransactionCount({ address: account.address });
        
        const gasPrice = await client.getGasPrice();
        const adjustedGasPrice = (gasPrice * BigInt(120)) / BigInt(100);

        const data = encodeFunctionData({
            abi: CONTRACT_ABI,
            functionName: 'depositETH',
            args: [account.address, value, BRIDGE_GAS_LIMIT],
        });

        const estimatedGas = await client.estimateGas({
            account: account.address,
            to: CONTRACT_ADDRESS,
            data: data,
            value: value,
        });
        const safeGasLimit = (estimatedGas * BigInt(130)) / BigInt(100);

        const preparedTransaction = await walletClient
            .prepareTransactionRequest({
                account,
                to: CONTRACT_ADDRESS,
                data: data,
                value: value,
                gas: safeGasLimit,
                gasPrice: adjustedGasPrice,
                nonce: nonce,
                type: 'legacy' 
            })
            .catch((e) => {
                printError(`Произошла ошибка во время подготовки транзакции - ${e}`);
                return undefined;
            });

        if (preparedTransaction != undefined) {
            const signature = await walletClient.signTransaction(preparedTransaction).catch((e) => {
                printError(`Произошла ошибка во время подписания транзакции - ${e}`);
                return undefined;
            });

            if (signature !== undefined) {
                const hash = await walletClient.sendRawTransaction({ serializedTransaction: signature }).catch((e) => {
                    printError(`Произошла ошибка во время отправки транзакции - ${e}`);
                    return false;
                });

                if (hash == false) {
                    return false;
                }

                const url = `${sepolia.blockExplorers?.default.url + '/tx/' + hash}`;

                const transaction = await client
                    .waitForTransactionReceipt({ hash: <`0x${string}`>hash })
                    .then(async (result) => {
                        printSuccess(`Транзакция успешно отправлена. Хэш транзакции: ${url}\n`);
                    })
                    .catch((e) => {
                        printError(`Произошла ошибка во время выполнения модуля - ${e}`);
                        return { request: undefined };
                    });
                
                return true;
            }
        }
        
        return false;

    } catch (error) {
        printError(`Произошла ошибка во время выполнения депозита - ${error}`);
        return false;
    }
} 