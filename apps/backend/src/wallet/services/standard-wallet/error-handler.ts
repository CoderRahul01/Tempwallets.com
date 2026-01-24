import { Logger, UnprocessableEntityException, ServiceUnavailableException } from '@nestjs/common';

export class StandardErrorHandler {
    private static readonly logger = new Logger('StandardErrorHandler');

    /**
     * Universal error handler for standard EVM wallet operations.
     * Maps lower-level errors to high-level exceptions.
     */
    static handle(error: any, context: string): never {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`[${context}] Error: ${message}`, error.stack);

        if (message.includes('insufficient funds')) {
            throw new UnprocessableEntityException(`Insufficient balance for transaction on ${context}`);
        }

        if (message.includes('gas required exceeds')) {
            throw new UnprocessableEntityException(`Gas estimation failed - possibly insufficient funds for fees on ${context}`);
        }

        if (message.includes('user rejected')) {
            throw new UnprocessableEntityException(`Transaction was rejected on ${context}`);
        }

        if (message.includes('replacement transaction underpriced')) {
            throw new ServiceUnavailableException(`Network congestion on ${context}: Replacement transaction underpriced`);
        }

        // Default to Service Unavailable for broad errors
        throw new ServiceUnavailableException(`EVM wallet service error (${context}): ${message}`);
    }
}
