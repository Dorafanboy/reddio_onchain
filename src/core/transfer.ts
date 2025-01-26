import {
    createPublicClient,
    createWalletClient,
    encodeFunctionData,
    formatUnits,
    http,
    PrivateKeyAccount,
    type PublicClient,
} from 'viem';
import { printError, printInfo, printSuccess } from '../data/logger/logPrinter';
import { Config, reddio } from '../config';
import { getSwapBalance, getValue } from '../data/utils/utils';
import { delay } from '../data/helpers/delayer';
import { CONTRACT_ABI_WITHDRAW } from './abi';
import { executeClaim } from './blockchain';

export async function transferREDOnWallet(account: PrivateKeyAccount): Promise<boolean> {
    printInfo(`Выполняю вывод Transfer Red to wallets`);

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

        printInfo(`Пытаюсь рассчитать сумму для трансфера`);


        value = await getValue(
            client,
            account.address,
            Config.tranferREDRange.range,
            Config.tranferREDRange.fixed,
            true,
        );

        currentTry++;

        if (value != null && value != BigInt(-1)) {
            currentTry = Config.retryCount + 1;
        } else {
            await delay(Config.delayBetweenAction.minRange, Config.delayBetweenAction.maxRange, false);
        }
    }

    if (!value) return false;

    const walletClient = createWalletClient({
        chain: reddio,
        transport: http(Config.rpcReddio)
    });

    try {
        printInfo(`Произвожу Transfer RED Reddio на ${formatUnits(value!, 18)} ETH`);

        const nonce = await client.getTransactionCount({ address: account.address });
        
        const preparedTransaction = await walletClient
            .prepareTransactionRequest({
                account,
                to: account.address,
                data: '0x',
                nonce: nonce,
                value: value
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
        printError(`Произошла ошибка во время выполнения вывода - ${error}`);
        return false;
    }
}
