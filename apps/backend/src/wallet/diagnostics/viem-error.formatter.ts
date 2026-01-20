export class ViemErrorFormatter {
    static format(error: any): string {
        if (!error) return 'Unknown error';

        // Handle string errors
        if (typeof error === 'string') return error;

        // Viem error handling
        if (error.name === 'BaseError' || error.baseError || error.details) {
            const details = error.details || error.shortMessage || error.message;

            // Specifically look for "UserOperation reverted during simulation with reason: 0x"
            if (details?.includes('UserOperation reverted during simulation')) {
                const reasonMatch = details.match(/reason: (0x[0-9a-fA-F]*)/);
                const reason = reasonMatch ? reasonMatch[1] : 'unknown';

                if (reason === '0x') {
                    return `Simulation Reverted: The transaction failed during simulation with an empty revert reason (0x). This often indicates a logic error in the smart contract or insufficient gas for the specific call. Check callGasLimit and verificationGasLimit.`;
                }

                return `Simulation Reverted: ${reason}. Details: ${details}`;
            }

            // Handle gas limit issues
            if (details?.includes('gas limit') || details?.includes('gasRequired')) {
                return `Gas Error: ${details}. This may be caused by an incorrect gas estimation or the account having insufficient funds for the operation.`;
            }

            // Fallback for other Viem errors
            return details || error.message || 'Unknown Viem error';
        }

        // Generic error handling
        return error.message || JSON.stringify(error);
    }

    static logError(logger: any, context: string, error: any) {
        const formatted = this.format(error);
        logger.error(`[${context}] ${formatted}`);

        // Log the full error to debug if it's not a known simple error
        if (process.env.NODE_ENV !== 'production' && !formatted.startsWith('Simulation Reverted')) {
            // Only log full stack trace in dev/staging for non-obvious errors
            console.error(`[Full Error Details for ${context}]:`, error);
        }
    }
}
