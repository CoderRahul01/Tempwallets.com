/**
 * Payment Channel Service
 *
 * Handles 2-party payment channel operations with Clearnode:
 * - Create channel (user ↔ clearnode)
 * - Resize channel (add/remove funds)
 * - Close channel (cooperative closure)
 *
 * IMPORTANT: Payment channels are ALWAYS 2-party (user + clearnode).
 * For multi-party Lightning Nodes, use App Sessions instead.
 *
 * Flow:
 * 1. Off-chain: Request channel creation via RPC
 * 2. On-chain: Submit to Custody.create() contract
 * 3. Channel becomes ACTIVE with zero or initial balance
 *
 * Protocol Reference:
 * - Channel Methods: /Users/monstu/Developer/crawl4Ai/yellow/docs_protocol_off-chain_channel-methods.md
 * - Channel Lifecycle: /Users/monstu/Developer/crawl4Ai/yellow/docs_protocol_on-chain_channel-lifecycle.md
 */

import type { Address, Hash, PublicClient, WalletClient } from 'viem';
import {
  encodeAbiParameters,
  parseAbiParameters,
  keccak256,
  toBytes,
} from 'viem';
import type { WebSocketManager } from './websocket-manager.js';
import type { SessionKeyAuth } from './session-auth.js';
import type {
  Channel,
  ChannelState,
  ChannelWithState,
  Allocation,
  RPCRequest,
} from './types.js';
import { StateIntent } from './types.js';

/**
 * Custody Contract ABI (minimal for channel operations)
 */
const CUSTODY_ABI = [
  {
    name: 'create',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'channelId', type: 'bytes32' },
      {
        name: 'state',
        type: 'tuple',
        components: [
          { name: 'intent', type: 'uint8' },
          { name: 'version', type: 'uint64' },
          { name: 'data', type: 'bytes' },
          {
            name: 'allocations',
            type: 'tuple[]',
            components: [
              { name: 'index', type: 'uint256' },
              { name: 'amount', type: 'uint256' },
            ],
          },
        ],
      },
      { name: 'sigs', type: 'bytes[]' },
    ],
    outputs: [],
  },
  {
    name: 'close',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'channelId', type: 'bytes32' },
      {
        name: 'state',
        type: 'tuple',
        components: [
          { name: 'intent', type: 'uint8' },
          { name: 'version', type: 'uint64' },
          { name: 'data', type: 'bytes' },
          {
            name: 'allocations',
            type: 'tuple[]',
            components: [
              { name: 'index', type: 'uint256' },
              { name: 'amount', type: 'uint256' },
            ],
          },
        ],
      },
      { name: 'sigs', type: 'bytes[]' },
    ],
    outputs: [],
  },
  {
    name: 'resize',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'channelId', type: 'bytes32' },
      {
        name: 'state',
        type: 'tuple',
        components: [
          { name: 'intent', type: 'uint8' },
          { name: 'version', type: 'uint64' },
          { name: 'data', type: 'bytes' },
          {
            name: 'allocations',
            type: 'tuple[]',
            components: [
              { name: 'index', type: 'uint256' },
              { name: 'amount', type: 'uint256' },
            ],
          },
        ],
      },
      { name: 'sigs', type: 'bytes[]' },
    ],
    outputs: [],
  },
] as const;

/**
 * Payment Channel Service
 *
 * Manages 2-party payment channels between user and clearnode
 */
export class ChannelService {
  private ws: WebSocketManager;
  private auth: SessionKeyAuth;
  private publicClient: PublicClient;
  private walletClient: WalletClient;
  private custodyAddresses: Record<number, Address>;

  constructor(
    ws: WebSocketManager,
    auth: SessionKeyAuth,
    publicClient: PublicClient,
    walletClient: WalletClient,
    custodyAddresses: Record<number, Address>,
  ) {
    this.ws = ws;
    this.auth = auth;
    this.publicClient = publicClient;
    this.walletClient = walletClient;
    this.custodyAddresses = custodyAddresses;
  }

  /**
   * Create a new 2-party payment channel (user ↔ clearnode)
   *
   * @param chainId - Blockchain chain ID
   * @param token - Token address (use '0x0000000000000000000000000000000000000000' for native)
   * @param initialDeposit - Optional initial deposit amount in smallest units
   * @returns Created channel with ID and state
   */
  async createChannel(
    chainId: number,
    token: Address,
    initialDeposit?: bigint,
  ): Promise<ChannelWithState> {
    console.log(`[ChannelService] Creating channel on chain ${chainId}...`);

    // Step 1: Request channel creation from clearnode
    const requestId = this.ws.getNextRequestId();
    let request: RPCRequest = {
      req: [
        requestId,
        'create_channel',
        { chain_id: chainId, token },
        Date.now(),
      ],
      sig: [] as string[],
    };

    // Sign with session key
    request = await this.auth.signRequest(request);

    const response = await this.ws.send(request);
    const channelData = response.res[2];

    console.log('[ChannelService] Received channel config from clearnode');

    // Parse channel and state from response
    const channel: Channel = {
      participants: [
        channelData.channel.participants[0] as Address,
        channelData.channel.participants[1] as Address,
      ],
      adjudicator: channelData.channel.adjudicator as Address,
      challenge: BigInt(channelData.channel.challenge),
      nonce: BigInt(channelData.channel.nonce),
    };

    const state: ChannelState = {
      intent: StateIntent.INITIALIZE,
      version: BigInt(0),
      data: '0x',
      allocations: initialDeposit
        ? [
            [BigInt(0), initialDeposit],
            [BigInt(1), BigInt(0)],
          ]
        : [
            [BigInt(0), BigInt(0)],
            [BigInt(1), BigInt(0)],
          ],
    };

    // Compute channel ID
    const channelId = this.computeChannelId(channel);

    console.log('[ChannelService] Channel ID:', channelId);

    // Step 2: Submit to on-chain Custody contract
    const custodyAddress = this.custodyAddresses[chainId];
    if (!custodyAddress) {
      throw new Error(`Custody address not found for chain ${chainId}`);
    }

    console.log(
      '[ChannelService] Submitting to Custody contract:',
      custodyAddress,
    );

    // Prepare signatures
    const signatures = [
      channelData.user_signature,
      channelData.server_signature,
    ];

    // Call Custody.create()
    const txHash = await this.walletClient.writeContract({
      address: custodyAddress,
      abi: CUSTODY_ABI,
      functionName: 'create',
      args: [
        channelId,
        {
          ...state,
          allocations: state.allocations.map(([index, amount]) => ({
            index,
            amount,
          })),
        } as any,
        signatures,
      ],
      chain: undefined, // Use wallet's current chain
      account: this.walletClient.account!,
    });

    console.log('[ChannelService] ✅ Channel created! TX:', txHash);

    // Wait for confirmation
    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash: txHash,
    });

    console.log(
      `[ChannelService] Transaction confirmed in block ${receipt.blockNumber}`,
    );

    return {
      ...channel,
      channelId,
      state,
      chainId,
      status: 'active',
    };
  }

  /**
   * Resize channel (add or remove funds)
   *
   * @param channelId - Channel identifier
   * @param chainId - Blockchain chain ID
   * @param amount - Amount to add (positive) or remove (negative) in smallest units
   * @returns Updated channel state
   */
  async resizeChannel(
    channelId: Hash,
    chainId: number,
    amount: bigint,
  ): Promise<ChannelState> {
    console.log(
      `[ChannelService] Resizing channel ${channelId} by ${amount}...`,
    );

    // Request resize from clearnode
    const requestId = this.ws.getNextRequestId();
    let request: RPCRequest = {
      req: [
        requestId,
        'resize_channel',
        {
          channel_id: channelId,
          resize_amount: amount.toString(),
        },
        Date.now(),
      ],
      sig: [] as string[],
    };

    request = await this.auth.signRequest(request);
    const response = await this.ws.send(request);
    const resizeData = response.res[2];

    // Parse new state
    const newState: ChannelState = {
      intent: StateIntent.RESIZE,
      version: BigInt(resizeData.state.version),
      data: resizeData.state.data,
      allocations: resizeData.state.allocations.map((alloc: any) => [
        BigInt(alloc[0]),
        BigInt(alloc[1]),
      ]),
    };

    // Submit to on-chain Custody contract
    const custodyAddress = this.custodyAddresses[chainId];
    if (!custodyAddress) {
      throw new Error(`Custody address not found for chain ${chainId}`);
    }
    const signatures = [resizeData.user_signature, resizeData.server_signature];

    const txHash = await this.walletClient.writeContract({
      address: custodyAddress,
      abi: CUSTODY_ABI,
      functionName: 'resize',
      args: [
        channelId,
        {
          ...newState,
          allocations: newState.allocations.map(([index, amount]) => ({
            index,
            amount,
          })),
        } as any,
        signatures,
      ],
      chain: undefined,
      account: this.walletClient.account!,
    });

    console.log('[ChannelService] ✅ Channel resized! TX:', txHash);

    await this.publicClient.waitForTransactionReceipt({ hash: txHash });

    return newState;
  }

  /**
   * Close channel cooperatively
   *
   * @param channelId - Channel identifier
   * @param chainId - Blockchain chain ID
   * @param fundsDestination - Address to send funds to
   * @returns Final channel state
   */
  async closeChannel(
    channelId: Hash,
    chainId: number,
    fundsDestination: Address,
  ): Promise<ChannelState> {
    console.log(`[ChannelService] Closing channel ${channelId}...`);

    // Request closure from clearnode
    const requestId = this.ws.getNextRequestId();
    let request: RPCRequest = {
      req: [
        requestId,
        'close_channel',
        {
          channel_id: channelId,
          funds_destination: fundsDestination,
        },
        Date.now(),
      ],
      sig: [] as string[],
    };

    request = await this.auth.signRequest(request);
    const response = await this.ws.send(request);
    const closeData = response.res[2];

    // Parse final state
    const finalState: ChannelState = {
      intent: StateIntent.FINALIZE,
      version: BigInt(closeData.state.version),
      data: '0x',
      allocations: closeData.state.allocations.map((alloc: any) => [
        BigInt(alloc[0]),
        BigInt(alloc[1]),
      ]),
    };

    // Submit to on-chain Custody contract
    const custodyAddress = this.custodyAddresses[chainId];
    if (!custodyAddress) {
      throw new Error(`Custody address not found for chain ${chainId}`);
    }
    const signatures = [closeData.user_signature, closeData.server_signature];

    const txHash = await this.walletClient.writeContract({
      address: custodyAddress,
      abi: CUSTODY_ABI,
      functionName: 'close',
      args: [
        channelId,
        {
          ...finalState,
          allocations: finalState.allocations.map(([index, amount]) => ({
            index,
            amount,
          })),
        } as any,
        signatures,
      ],
      chain: undefined,
      account: this.walletClient.account!,
    });

    console.log('[ChannelService] ✅ Channel closed! TX:', txHash);

    await this.publicClient.waitForTransactionReceipt({ hash: txHash });

    return finalState;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Compute channel ID from channel definition
   * channelId = keccak256(abi.encode(participants, adjudicator, challenge, nonce))
   */
  private computeChannelId(channel: Channel): Hash {
    const encoded = encodeAbiParameters(
      parseAbiParameters('address[2], address, uint256, uint256'),
      [
        channel.participants,
        channel.adjudicator,
        channel.challenge,
        channel.nonce,
      ],
    );

    return keccak256(encoded);
  }
}
