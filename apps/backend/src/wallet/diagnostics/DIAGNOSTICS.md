    # Diagnostic Logs: EIP-7702 & Zerion
    This directory contains dedicated diagnostic tools and persistent log records for complex wallet operations.

    ## Current Diagnostic Focus

    ### 1. EIP-7702 Simulation Failures (Polygon)
    - **Problem**: Transactions were reverting with a `0x` reason during simulation on Polygon.
    - **Cause Detected**: Parameter mismatch in `WalletService`. It was using `token`/`recipient` keys instead of `tokenAddress`/`to`.
    - **Resolution**: Fixed mapping in `WalletService.sendCrypto` to use standardized keys.
    - **Persistent Logs**: Detailed simulation parameters are now captured in `logs/eip7702-diagnostics.log`.

    ### 2. Zerion API Mapping
    - **Problem**: 400 Malformed parameters when using camelCase chains (e.g., `astarShibuya`).
    - **Resolution**: Fixed `mapToZerionChain` to handle kebab-case conversion.
    - **Persistent Logs**: Zerion response structures are tracked in `logs/zerion-diagnostics.log`.

    ## Usage
    Diagnostic tools are located in `src/wallet/diagnostics/`.
    - `ViemErrorFormatter`: Decodes complex Viem errors.
    - `DiagnosticLogger`: Writes detailed logs to the project root `logs/` folder.
    - `logs/*.log`: Inspect these files for full JSON payloads of failed or interesting transactions.
