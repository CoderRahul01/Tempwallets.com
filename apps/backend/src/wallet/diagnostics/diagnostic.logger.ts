import { Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

/**
 * DiagnosticLogger
 * Handles persistent file-based logging for critical wallet events
 */
export class DiagnosticLogger {
    private static readonly logDir = path.join(process.cwd(), 'logs');
    private static readonly logger = new Logger('DiagnosticLogger');

    /**
     * Log a detailed event to both console and a specific file
     * @param filename - Name of the log file (e.g., 'eip7702-transactions.log')
     * @param context - Context string for identifying the event
     * @param data - The data object or message to log
     */
    static logDetailed(filename: string, context: string, data: any) {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] [${context}] ${typeof data === 'string' ? data : JSON.stringify(data, null, 2)}\n`;
        const logPath = path.join(this.logDir, filename);

        // Ensure logs directory exists
        if (!fs.existsSync(this.logDir)) {
            try {
                fs.mkdirSync(this.logDir, { recursive: true });
            } catch (err) {
                const errorMessage = err instanceof Error ? err.message : String(err);
                this.logger.error(`Failed to create log directory: ${errorMessage}`);
                return;
            }
        }

        // Write to file
        try {
            fs.appendFileSync(logPath, logMessage, 'utf8');
            this.logger.log(`[File Logged] ${context} -> logs/${filename}`);
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            this.logger.error(`Failed to write to diagnostic log file: ${errorMessage}`);
        }

        // Mirror to standard logger
        if (typeof data === 'string') {
            this.logger.log(`[${context}] ${data}`);
        } else {
            this.logger.log(`[${context}] (details saved to file)`);
        }
    }

    /**
     * Specifically log EIP-7702 transaction details
     */
    static logEip7702Transaction(context: string, details: any) {
        this.logDetailed('eip7702-diagnostics.log', context, details);
    }

    /**
     * Specifically log Zerion API mapping/response details
     */
    static logZerionDiagnostic(context: string, details: any) {
        this.logDetailed('zerion-diagnostics.log', context, details);
    }

    /**
     * Specifically log errors discovered during diagnostics
     */
    static logDiagnosticError(context: string, error: any) {
        this.logDetailed('diagnostic-errors.log', context, {
            message: error.message || error,
            stack: error.stack,
            raw: error
        });
    }
}
