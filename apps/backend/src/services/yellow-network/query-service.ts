/**
 * Query Service
 *
 * Provides query methods for:
 * - Unified balance (off-chain ledger)
 * - App sessions (Lightning Nodes)
 * - Payment channels
 * - Transaction history
 *
 * Protocol Reference:
 * - Query Methods: /Users/monstu/Developer/crawl4Ai/yellow/docs_protocol_off-chain_queries.md
 */

import type { Address, Hash } from 'viem';
import type { WebSocketManager } from './websocket-manager.js';
import type { SessionKeyAuth } from './session-auth.js';
import type {
  LedgerBalance,
  LedgerTransaction,
  AppSession,
  ChannelWithState,
  RPCRequest,
} from './types.js';

/**
 * Query Service
 *
 * Handles all query operations for balances, channels, and sessions
 */
export class QueryService {
  private ws: WebSocketManager;
  private auth: SessionKeyAuth;

  constructor(ws: WebSocketManager, auth: SessionKeyAuth) {
    this.ws = ws;
    this.auth = auth;
  }

  /**
   * Get unified balance for account
   *
   * @param accountId - Optional account ID (defaults to authenticated user)
   * @returns Array of balance entries per asset
   */
  async getLedgerBalances(accountId?: string): Promise<LedgerBalance[]> {
    console.log('[QueryService] Fetching ledger balances...');

    const requestId = this.ws.getNextRequestId();
    let request: RPCRequest = {
      req: [
        requestId,
        'get_ledger_balances',
        accountId ? { account_id: accountId } : {},
        Date.now(),
      ],
      sig: [] as string[],
    };

    request = await this.auth.signRequest(request);
    const response = await this.ws.send(request);
    const balanceData = response.res[2];

    const balances: LedgerBalance[] = balanceData.ledger_balances.map(
      (b: any) => ({
        asset: b.asset,
        amount: b.amount,
        locked: b.locked || '0',
        available: b.available || b.amount,
      }),
    );

    console.log(
      `[QueryService] Found ${balances.length} assets in unified balance`,
    );

    return balances;
  }

  /**
   * Get all app sessions (Lightning Nodes)
   *
   * @param status - Filter by status ('open' or 'closed')
   * @param participant - Filter by participant wallet address (optional but recommended)
   * @returns Array of app sessions
   */
  async getAppSessions(
    status?: 'open' | 'closed',
    participant?: string
  ): Promise<AppSession[]> {
    console.log('[QueryService] Fetching app sessions...');

    // Build filter parameters
    const params: any = {};
    if (status) params.status = status;
    if (participant) {
      params.participant = participant;
      console.log(`[QueryService] Filtering by participant: ${participant}`);
    }

    const requestId = this.ws.getNextRequestId();
    let request: RPCRequest = {
      req: [
        requestId,
        'get_app_sessions',
        params,
        Date.now(),
      ],
      sig: [] as string[],
    };

    request = await this.auth.signRequest(request);
    const response = await this.ws.send(request);
    const sessionsData = response.res[2];

    const sessions: AppSession[] = sessionsData.app_sessions.map((s: any) => ({
      app_session_id: s.app_session_id,
      status: s.status,
      version: s.version,
      session_data: s.session_data,
      allocations: s.allocations || [],
      definition: s.definition,
      createdAt: new Date(s.created_at),
      updatedAt: new Date(s.updated_at),
      closedAt: s.closed_at ? new Date(s.closed_at) : undefined,
    }));

    console.log(`[QueryService] Found ${sessions.length} app sessions`);

    return sessions;
  }

  /**
   * Get payment channels
   *
   * @returns Array of payment channels
   */
  async getChannels(): Promise<ChannelWithState[]> {
    console.log('[QueryService] Fetching payment channels...');

    const requestId = this.ws.getNextRequestId();
    let request: RPCRequest = {
      req: [requestId, 'get_channels', {}, Date.now()],
      sig: [] as string[],
    };

    request = await this.auth.signRequest(request);
    const response = await this.ws.send(request);
    const channelsData = response.res[2];

    const channels: ChannelWithState[] = channelsData.channels.map(
      (c: any) => ({
        participants: [c.participants[0], c.participants[1]],
        adjudicator: c.adjudicator,
        challenge: BigInt(c.challenge),
        nonce: BigInt(c.nonce),
        channelId: c.channel_id,
        state: {
          intent: c.state.intent,
          version: BigInt(c.state.version),
          data: c.state.data,
          allocations: c.state.allocations.map((a: any) => [
            BigInt(a[0]),
            BigInt(a[1]),
          ]),
        },
        chainId: c.chain_id,
        status: c.status,
      }),
    );

    console.log(`[QueryService] Found ${channels.length} payment channels`);

    return channels;
  }

  /**
   * Get ledger transaction history
   *
   * @param filters - Optional filters (asset, type, limit, offset)
   * @returns Array of transactions
   */
  async getLedgerTransactions(filters?: {
    asset?: string;
    type?: string;
    limit?: number;
    offset?: number;
  }): Promise<LedgerTransaction[]> {
    console.log('[QueryService] Fetching ledger transactions...');

    const requestId = this.ws.getNextRequestId();
    let request: RPCRequest = {
      req: [requestId, 'get_ledger_transactions', filters || {}, Date.now()],
      sig: [] as string[],
    };

    request = await this.auth.signRequest(request);
    const response = await this.ws.send(request);
    const txData = response.res[2];

    const transactions: LedgerTransaction[] = txData.transactions.map(
      (tx: any) => ({
        id: tx.id,
        type: tx.type,
        asset: tx.asset,
        amount: tx.amount,
        from: tx.from,
        to: tx.to,
        timestamp: tx.timestamp,
        status: tx.status,
      }),
    );

    console.log(`[QueryService] Found ${transactions.length} transactions`);

    return transactions;
  }

  /**
   * Get app definition (governance parameters and participants)
   *
   * Uses Yellow Network's get_app_definition RPC method to retrieve the
   * immutable definition for a specific app session. This method always
   * returns full participant information unlike get_app_sessions which
   * may filter participants for privacy when querying all sessions.
   *
   * @param appSessionId - App session identifier
   * @returns App definition with participants, weights, quorum, etc.
   */
  async getAppDefinition(appSessionId: Hash): Promise<any> {
    console.log(`[QueryService] Fetching app definition for ${appSessionId}...`);

    const requestId = this.ws.getNextRequestId();
    const request: RPCRequest = {
      req: [
        requestId,
        'get_app_definition',
        { app_session_id: appSessionId },
        Date.now(),
      ],
      sig: [] as string[], // Public method
    };

    const response = await this.ws.send(request);
    const definition = response.res[2];

    console.log(`[QueryService] ✅ Got app definition with ${definition.participants?.length || 0} participants`);

    return {
      protocol: definition.protocol,
      participants: definition.participants || [],
      weights: definition.weights || [],
      quorum: definition.quorum,
      challenge: definition.challenge,
      nonce: definition.nonce,
    };
  }

  /**
   * Get single app session by ID
   *
   * Fetches both the session metadata (status, version, allocations) and
   * the full definition (participants, weights, quorum) by combining
   * get_app_sessions and get_app_definition RPC calls.
   *
   * @param appSessionId - App session identifier
   * @returns App session details with full definition
   */
  async getAppSession(appSessionId: Hash): Promise<AppSession> {
    console.log(`[QueryService] Fetching app session ${appSessionId}...`);

    // Get session metadata from get_app_sessions
    const sessions = await this.getAppSessions();
    const session = sessions.find((s) => s.app_session_id === appSessionId);

    if (!session) {
      throw new Error(`App session ${appSessionId} not found`);
    }

    // Get full definition with participants from get_app_definition
    // This ensures we always have participant data even if get_app_sessions filtered it
    try {
      const definition = await this.getAppDefinition(appSessionId);
      console.log(`[QueryService] ✅ Merged definition with ${definition.participants.length} participants`);

      return {
        ...session,
        definition: definition,
      };
    } catch (error) {
      // If get_app_definition fails, return session with existing definition
      // (may have empty participants but at least we have the session)
      console.warn(`[QueryService] Failed to get app definition, using session definition:`, error);
      return session;
    }
  }

  /**
   * Ping clearnode to check connection
   *
   * @returns Pong response with timestamp
   */
  async ping(): Promise<{ pong: string; timestamp: number }> {
    const requestId = this.ws.getNextRequestId();
    const request: RPCRequest = {
      req: [requestId, 'ping', {}, Date.now()],
      sig: [] as string[], // Public method
    };

    const response = await this.ws.send(request);
    const pongData = response.res[2];

    // Handle null or undefined pongData
    if (!pongData || typeof pongData !== 'object') {
      return {
        pong: 'pong',
        timestamp: Date.now(),
      };
    }

    return {
      pong: pongData.pong || 'pong',
      timestamp: pongData.timestamp || Date.now(),
    };
  }
}
