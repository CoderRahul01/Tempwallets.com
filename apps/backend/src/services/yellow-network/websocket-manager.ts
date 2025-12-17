/**
 * WebSocket Manager for Yellow Network Clearnode RPC
 *
 * Handles WebSocket connection lifecycle, message routing, and reconnection logic.
 * Implements exponential backoff for reconnection attempts.
 *
 * Key Features:
 * - Automatic reconnection with exponential backoff
 * - Request/response correlation via request IDs
 * - Message queueing when disconnected
 * - Promise-based request/response handling
 *
 * Protocol Reference:
 * - Message Format: /Users/monstu/Developer/crawl4Ai/yellow/docs_protocol_off-chain_message-format.md
 */

import WebSocket from 'ws';
import type {
  RPCRequest,
  RPCResponse,
  WebSocketConfig,
  AssetInfo,
} from './types.js';
import { ConnectionState } from './types.js';

/**
 * Response Handler Callback Type
 */
type ResponseHandler = (response: RPCResponse) => void;

/**
 * WebSocket Event Handlers
 */
interface WSEventHandlers {
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Error) => void;
  onMessage?: (data: any) => void;
}

/**
 * WebSocket Manager Class
 *
 * Manages WebSocket connection to Yellow Network Clearnode
 * with automatic reconnection and message queueing.
 */
export class WebSocketManager {
  private ws: WebSocket | null = null;
  private url: string;
  private connectionState: ConnectionState = ConnectionState.DISCONNECTED;

  // Configuration
  private reconnectAttempts: number;
  private maxReconnectAttempts: number;
  private reconnectDelay: number;
  private maxReconnectDelay: number;
  private requestTimeout: number;

  // Message queue for offline requests
  private messageQueue: RPCRequest[] = [];

  // Request/response correlation
  private responseHandlers: Map<number, ResponseHandler> = new Map();
  private requestIdCounter = 1;

  // Cached server-pushed assets catalog
  private assetsCache: AssetInfo[] = [];

  // Reconnection timer
  private reconnectTimer: NodeJS.Timeout | null = null;

  // Event handlers
  private eventHandlers: WSEventHandlers = {};

  constructor(config: WebSocketConfig) {
    this.url = config.url;
    this.maxReconnectAttempts = config.reconnectAttempts ?? 5;
    this.reconnectDelay = config.reconnectDelay ?? 1000;
    this.maxReconnectDelay = config.maxReconnectDelay ?? 30000;
    this.requestTimeout = config.requestTimeout ?? 30000;
    this.reconnectAttempts = 0;
  }

  /**
   * Connect to Clearnode WebSocket
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.connectionState === ConnectionState.CONNECTED) {
        resolve();
        return;
      }

      this.connectionState = ConnectionState.CONNECTING;
      console.log(`[WebSocket] Connecting to ${this.url}...`);

      try {
        this.ws = new WebSocket(this.url);
      } catch (error) {
        this.connectionState = ConnectionState.FAILED;
        reject(error);
        return;
      }

      this.ws.on('open', () => {
        console.log('[WebSocket] Connected to Clearnode');
        this.connectionState = ConnectionState.CONNECTED;
        this.reconnectAttempts = 0; // Reset counter on successful connection

        // Flush any queued messages
        this.flushMessageQueue();

        // Notify listeners
        this.eventHandlers.onConnect?.();

        resolve();
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          const response: RPCResponse = JSON.parse(data.toString());
          this.handleMessage(response);
        } catch (error) {
          console.error('[WebSocket] Failed to parse message:', error);
          this.eventHandlers.onError?.(error as Error);
        }
      });

      this.ws.on('error', (error: Error) => {
        console.error('[WebSocket] Error:', error);
        this.eventHandlers.onError?.(error);

        if (this.connectionState === ConnectionState.CONNECTING) {
          reject(error);
        }
      });

      this.ws.on('close', (code: number, reason: Buffer) => {
        const reasonStr = reason.toString();
        console.log(
          `[WebSocket] Disconnected (code: ${code}, reason: ${reasonStr})`,
        );

        this.connectionState = ConnectionState.DISCONNECTED;
        this.ws = null;

        // Notify listeners
        this.eventHandlers.onDisconnect?.();

        // Attempt reconnection if not intentionally closed
        if (
          code !== 1000 &&
          this.reconnectAttempts < this.maxReconnectAttempts
        ) {
          this.scheduleReconnect();
        } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          console.error('[WebSocket] Max reconnection attempts reached');
          this.connectionState = ConnectionState.FAILED;
        }
      });

      // Connection timeout
      const timeout = setTimeout(() => {
        if (this.connectionState === ConnectionState.CONNECTING) {
          this.ws?.terminate();
          reject(new Error('Connection timeout'));
        }
      }, this.requestTimeout);

      this.ws.once('open', () => clearTimeout(timeout));
    });
  }

  /**
   * Disconnect from Clearnode WebSocket
   */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      console.log('[WebSocket] Disconnecting...');
      this.ws.close(1000, 'Client disconnect'); // Normal closure
      this.ws = null;
    }

    this.connectionState = ConnectionState.DISCONNECTED;
  }

  /**
   * Send RPC request and wait for response
   */
  async send(request: RPCRequest): Promise<RPCResponse> {
    return new Promise((resolve, reject) => {
      const requestId = request.req[0];

      // Set up response handler
      this.responseHandlers.set(requestId, (response: RPCResponse) => {
        if (response.error) {
          reject(new Error(response.error.message || 'RPC error'));
        } else {
          resolve(response);
        }
      });

      // Set timeout for request
      const timeout = setTimeout(() => {
        this.responseHandlers.delete(requestId);
        reject(
          new Error(
            `Request ${requestId} timed out after ${this.requestTimeout}ms`,
          ),
        );
      }, this.requestTimeout);

      // Clear timeout when response arrives
      const originalHandler = this.responseHandlers.get(requestId)!;
      this.responseHandlers.set(requestId, (response) => {
        clearTimeout(timeout);
        originalHandler(response);
      });

      // Send message if connected, otherwise queue
      if (this.ws?.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify(request));
        } catch (error) {
          this.responseHandlers.delete(requestId);
          clearTimeout(timeout);
          reject(error);
        }
      } else {
        console.log(`[WebSocket] Queueing message (requestId: ${requestId})`);
        this.messageQueue.push(request);
      }
    });
  }

  /**
   * Get next available request ID
   */
  getNextRequestId(): number {
    return this.requestIdCounter++;
  }

  /**
   * Register event handlers
   */
  on(
    event: 'connect' | 'disconnect' | 'error' | 'message',
    handler: (...args: any[]) => void,
  ): void {
    switch (event) {
      case 'connect':
        this.eventHandlers.onConnect = handler;
        break;
      case 'disconnect':
        this.eventHandlers.onDisconnect = handler;
        break;
      case 'error':
        this.eventHandlers.onError = handler;
        break;
      case 'message':
        this.eventHandlers.onMessage = handler;
        break;
    }
  }

  /**
   * Get current connection state
   */
  getState(): ConnectionState {
    return this.connectionState;
  }

  /**
   * Get cached asset catalog (last received via notification)
   */
  getAssetsCache(): AssetInfo[] {
    return this.assetsCache;
  }

  /**
   * Check if WebSocket is connected
   */
  isConnected(): boolean {
    return (
      this.connectionState === ConnectionState.CONNECTED &&
      this.ws?.readyState === WebSocket.OPEN
    );
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(response: RPCResponse): void {
    const requestId = response.res[0];
    const method = response.res[1];

    // Notify general message handler
    this.eventHandlers.onMessage?.(response);

    // Handle correlated request/response
    const handler = this.responseHandlers.get(requestId);
    if (handler) {
      handler(response);
      this.responseHandlers.delete(requestId);
    } else {
      // Unsolicited message (notification)
      console.log(`[WebSocket] Notification received: ${method}`);
      this.handleNotification(response);
    }
  }

  /**
   * Handle server-initiated notifications
   * Examples: bu (balance update), cu (channel update), tr (transfer), asu (app session update)
   */
  private handleNotification(response: RPCResponse): void {
    const method = response.res[1];
    const data = response.res[2];

    switch (method) {
      case 'bu': // Balance Update
        console.log('[Notification] Balance updated:', data);
        break;
      case 'cu': // Channel Update
        console.log('[Notification] Channel updated:', data);
        break;
      case 'tr': // Transfer
        console.log('[Notification] Transfer received:', data);
        break;
      case 'asu': // App Session Update
        console.log('[Notification] App session updated:', data);
        break;
      case 'assets':
        // Cache and avoid noisy full dumps
        if (Array.isArray(data?.assets)) {
          this.assetsCache = data.assets as AssetInfo[];
          console.log(
            `[Notification] Assets catalog received (${this.assetsCache.length} assets)`,
          );
        } else {
          console.log(
            '[Notification] Assets catalog received (unexpected format)',
          );
        }
        break;
      default:
        console.log(
          `[Notification] Unknown notification type: ${method}`,
          data,
        );
    }
  }

  /**
   * Flush queued messages after reconnection
   */
  private flushMessageQueue(): void {
    if (!this.isConnected() || this.messageQueue.length === 0) {
      return;
    }

    console.log(
      `[WebSocket] Flushing ${this.messageQueue.length} queued messages`,
    );

    while (this.messageQueue.length > 0 && this.isConnected()) {
      const request = this.messageQueue.shift();
      if (request && this.ws) {
        try {
          this.ws.send(JSON.stringify(request));
        } catch (error) {
          console.error('[WebSocket] Failed to send queued message:', error);
          // Re-queue if failed
          this.messageQueue.unshift(request);
          break;
        }
      }
    }
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return; // Already scheduled
    }

    this.reconnectAttempts++;
    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      this.maxReconnectDelay,
    );

    console.log(
      `[WebSocket] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`,
    );

    this.connectionState = ConnectionState.RECONNECTING;

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;

      try {
        await this.connect();
      } catch (error) {
        console.error('[WebSocket] Reconnection failed:', error);
        // Will automatically schedule another attempt via close handler
      }
    }, delay);
  }
}
