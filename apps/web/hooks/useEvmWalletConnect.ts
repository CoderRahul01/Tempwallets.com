'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { WalletKit, IWalletKit } from '@reown/walletkit';
import { Core } from '@walletconnect/core';
import { SessionTypes } from '@walletconnect/types';
import { walletApi } from '@/lib/api';
import { createLogger, getTraceId } from '@/utils/logger';
import { metrics } from '@/utils/metrics';
import {
  trackWalletConnectInitialized,
  trackWalletConnectProposalReceived,
  trackWalletConnectSessionApproved,
  trackWalletConnectSessionRejected,
  trackWalletConnectRequestReceived,
  trackWalletConnectRequestSigned,
  trackWalletConnectRequestRejected,
  trackWalletConnectSessionDisconnected,
  trackWalletConnectPairingSuccess,
  trackWalletConnectApprovalFailed,
  trackWalletConnectSigningFailed,
} from '@/lib/mixpanel-events';

const logger = createLogger('evm-walletconnect');

export interface EvmWalletConnectSession {
  topic: string;
  peer: {
    metadata?: {
      name?: string;
      description?: string;
      url?: string;
      icons?: string[];
    };
  };
  namespaces: SessionTypes.Namespaces;
}

export interface UseEvmWalletConnectReturn {
  client: IWalletKit | null;
  sessions: EvmWalletConnectSession[];
  isInitializing: boolean;
  error: string | null;
  pair: (uri: string) => Promise<void>;
  disconnect: (topic: string) => Promise<void>;
  approveSession: (proposalId: number, namespaces: SessionTypes.Namespaces) => Promise<void>;
  rejectSession: (proposalId: number) => Promise<void>;
  initialize: () => Promise<void>;
}

// Global client instance to prevent multiple initializations
// Track which userId the client was initialized with
let globalWalletKit: IWalletKit | null = null;
let globalWalletKitUserId: string | null = null;
let isInitializingGlobal = false;

export function useEvmWalletConnect(userId: string | null): UseEvmWalletConnectReturn {
  const [client, setClient] = useState<IWalletKit | null>(null);
  const [sessions, setSessions] = useState<EvmWalletConnectSession[]>([]);
  const [isInitializing, setIsInitializing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isInitializedRef = useRef(false);
  const currentUserIdRef = useRef<string | null>(null);

  const initialize = useCallback(async () => {
    if (!userId) {
      setIsInitializing(false);
      return;
    }

    // Update current userId ref
    currentUserIdRef.current = userId;

    // If userId changed, reset the global client to force re-initialization
    if (globalWalletKit && globalWalletKitUserId !== userId) {
      logger.log(`UserId changed from ${globalWalletKitUserId} to ${userId}, resetting WalletConnect client`);
      globalWalletKit = null;
      globalWalletKitUserId = null;
      isInitializedRef.current = false;
    }

    // Use existing client if available and userId matches
    if (globalWalletKit && globalWalletKitUserId === userId) {
      setClient(globalWalletKit);
      setIsInitializing(false);
      isInitializedRef.current = true;
      const existingSessions = globalWalletKit.getActiveSessions();
      setSessions(Object.values(existingSessions));
      return;
    }

    if (isInitializedRef.current || isInitializingGlobal) {
      setIsInitializing(false);
      return;
    }

    isInitializingGlobal = true;
    setIsInitializing(true);

    try {
      const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
      if (!projectId) {
        throw new Error('NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is not set');
      }

      // Initialize Core first
      const core = new Core({
        projectId,
      });

      // Initialize WalletKit with Core
      const walletKit = await WalletKit.init({
        core,
        metadata: {
          name: 'Tempwallets',
          description: 'Your Secure Multi-Chain Wallet',
          url: typeof window !== 'undefined' ? window.location.origin : 'https://tempwallets.com',
          icons: [`${typeof window !== 'undefined' ? window.location.origin : 'https://tempwallets.com'}/tempwallets-logo.png`],
        },
      });

      globalWalletKit = walletKit;
      globalWalletKitUserId = userId;
      setClient(walletKit);
      setIsInitializing(false);
      isInitializedRef.current = true;
      isInitializingGlobal = false;

      // Load existing sessions
      const existingSessions = walletKit.getActiveSessions();
      setSessions(Object.values(existingSessions));

      // Track WalletConnect initialization
      trackWalletConnectInitialized({ userId });

      // Listen for session proposals
      walletKit.on('session_proposal', async (proposal) => {
        // Session proposal received - only log errors
        // Use current userId from ref to ensure we always use the latest userId
        const currentUserId = currentUserIdRef.current;
        if (!currentUserId) {
          logger.error('No userId available for session proposal');
          return;
        }

        // Save proposal to backend
        await walletApi.saveWcProposal(
          currentUserId,
          proposal.id,
          proposal.params.proposer,
          proposal.params.requiredNamespaces,
          proposal.params.optionalNamespaces,
          new Date(proposal.params.expiryTimestamp * 1000),
        );

        // Track proposal received
        const eip155Required = proposal.params.requiredNamespaces?.eip155;
        const eip155Optional = proposal.params.optionalNamespaces?.eip155;
        trackWalletConnectProposalReceived({
          userId: currentUserId,
          proposalId: proposal.id,
          dappName: proposal.params.proposer.metadata?.name || 'Unknown',
          dappUrl: proposal.params.proposer.metadata?.url || 'Unknown',
          requiredChains: eip155Required?.chains || [],
          optionalChains: eip155Optional?.chains || [],
        });

        // Show approval dialog
        const approved = window.confirm(
          `Connect your Tempwallet to ${proposal.params.proposer.metadata?.name || 'Unknown DApp'}?\n\n` +
          `URL: ${proposal.params.proposer.metadata?.url || 'Unknown'}\n\n` +
          `This will allow the dApp to request transactions from your Tempwallet.`
        );

        if (approved) {
          try {
            // ✅ FIXED: Handle chains from multiple sources
            const eip155Required = proposal.params.requiredNamespaces?.eip155;
            const eip155Optional = proposal.params.optionalNamespaces?.eip155;

            // Get chains from both required and optional
            const requiredChains = eip155Required?.chains || [];
            const optionalChains = eip155Optional?.chains || [];

            // Combine all requested chains
            let allChains = [...requiredChains, ...optionalChains];

            // Remove duplicates
            allChains = [...new Set(allChains)];

            // Extract chain IDs (convert "eip155:1" -> 1)
            let approvedChainIds: number[] = allChains
              .filter((c: string) => c.startsWith('eip155:'))
              .map((c: string) => {
                const parts = c.split(':');
                if (parts.length < 2 || !parts[1]) {
                  return null;
                }
                const chainId = parseInt(parts[1], 10);
                return isNaN(chainId) ? null : chainId;
              })
              .filter((id): id is number => id !== null);

            // ✅ CRITICAL: If no chains specified, use ALL user's chains
            if (approvedChainIds.length === 0) {
              // Get user's EIP-7702 accounts (use current userId from ref)
              const accountsResponse = await walletApi.getWcAccounts(currentUserId);

              // Extract unique chain IDs
              approvedChainIds = [...new Set(
                accountsResponse.accounts.map((acc: { chainId: number }) => acc.chainId)
              )];
            }

            // Ensure we have at least one chain
            if (approvedChainIds.length === 0) {
              throw new Error('No chains available. Please create a wallet first.');
            }

            // Request approval from backend (use current userId from ref)
            const { namespaces, session: sessionData } = await walletApi.approveWcProposal(
              currentUserId,
              proposal.id,
              approvedChainIds,
            );

            // Approve on WalletKit
            const { topic } = await walletKit.approveSession({
              id: proposal.id,
              namespaces,
            });

            // Save full session to backend (use current userId from ref)
            const sessions = walletKit.getActiveSessions();
            const session = sessions[topic];
            if (session) {
              await walletApi.saveWcSession(currentUserId, session, namespaces);
            }

            // Update local sessions
            setSessions(Object.values(walletKit.getActiveSessions()));

            // Track session approval (use current userId from ref)
            const accountsResponse = await walletApi.getWcAccounts(currentUserId);
            const hasEip7702 = accountsResponse.accounts.some((acc: any) => acc.hasEip7702);
            trackWalletConnectSessionApproved({
              userId: currentUserId,
              proposalId: proposal.id,
              dappName: proposal.params.proposer.metadata?.name || 'Unknown',
              dappUrl: proposal.params.proposer.metadata?.url || 'Unknown',
              approvedChains: approvedChainIds,
              accountCount: accountsResponse.accounts.length,
              hasEip7702,
            });

            metrics.increment('walletconnect.session.approved', { namespace: 'eip155' });
          } catch (err) {
            logger.error('Failed to approve session', err as Error);

            // Track approval failure (use current userId from ref)
            trackWalletConnectApprovalFailed({
              userId: currentUserId,
              proposalId: proposal.id,
              dappName: proposal.params.proposer.metadata?.name || 'Unknown',
              errorMessage: err instanceof Error ? err.message : 'Failed to approve',
            });

            await walletApi.rejectWcProposal(currentUserId, proposal.id, err instanceof Error ? err.message : 'Failed to approve');
            await walletKit.rejectSession({
              id: proposal.id,
              reason: {
                code: 5000,
                message: err instanceof Error ? err.message : 'Failed to approve session',
              },
            });
          }
        } else {
          // Track session rejection (use current userId from ref)
          trackWalletConnectSessionRejected({
            userId: currentUserId,
            proposalId: proposal.id,
            dappName: proposal.params.proposer.metadata?.name || 'Unknown',
            reason: 'User rejected',
          });

          await walletApi.rejectWcProposal(currentUserId, proposal.id, 'User rejected');
          await walletKit.rejectSession({
            id: proposal.id,
            reason: {
              code: 5000,
              message: 'User rejected',
            },
          });
        }
      });

      // Listen for session requests
      walletKit.on('session_request', async (event) => {
        // Session request received - only log errors
        // Use current userId from ref to ensure we always use the latest userId
        const currentUserId = currentUserIdRef.current;
        if (!currentUserId) {
          logger.error('No userId available for session request');
          return;
        }

        const { id, topic, params } = event;
        const { request, chainId } = params;

        // Get dApp name from session
        const sessions = walletKit.getActiveSessions();
        const session = sessions[topic];
        const dappName = session?.peer.metadata?.name || 'Unknown';

        // Track request received
        trackWalletConnectRequestReceived({
          userId: currentUserId,
          requestId: id,
          dappName,
          method: request.method,
          chainId,
        });

        const requestStartTime = Date.now();

        try {
          // Show confirmation dialog
          const confirmed = window.confirm(
            `Sign ${request.method}?\n\n` +
            `Chain: ${chainId}\n` +
            `Method: ${request.method}\n\n` +
            `Review details carefully before confirming.`
          );

          if (!confirmed) {
            throw new Error('User rejected request');
          }

          // Request signature from backend (use current userId from ref)
          const { signature } = await walletApi.signWcRequest(
            currentUserId,
            topic,
            id,
            request.method,
            request.params,
            chainId,
          );

          // Send response
          await walletKit.respondSessionRequest({
            topic,
            response: {
              id,
              jsonrpc: '2.0',
              result: signature,
            },
          });

          // Track successful signing (use current userId from ref)
          const signatureDuration = Date.now() - requestStartTime;
          trackWalletConnectRequestSigned({
            userId: currentUserId,
            requestId: id,
            dappName,
            method: request.method,
            chainId,
            signatureDuration,
          });

          // Request signed successfully
          metrics.increment('walletconnect.request.success', { method: request.method });
        } catch (err) {
          logger.error('Failed to sign request', err as Error);

          const errorMessage = err instanceof Error ? err.message : 'Failed to sign';
          const isUserRejection = errorMessage.includes('rejected');

          // Track signing failure (use current userId from ref)
          if (isUserRejection) {
            trackWalletConnectRequestRejected({
              userId: currentUserId,
              requestId: id,
              dappName,
              method: request.method,
              reason: errorMessage,
            });
          } else {
            trackWalletConnectSigningFailed({
              userId: currentUserId,
              requestId: id,
              dappName,
              method: request.method,
              errorMessage,
            });
          }

          await walletKit.respondSessionRequest({
            topic,
            response: {
              id,
              jsonrpc: '2.0',
              error: {
                code: 5000,
                message: errorMessage,
              },
            },
          });
          metrics.increment('walletconnect.request.failed', {
            method: request.method,
            reason: errorMessage,
          });
        }
      });

      // Listen for session delete
      walletKit.on('session_delete', async (event) => {
        // Session deleted - only log errors
        // Use current userId from ref to ensure we always use the latest userId
        const currentUserId = currentUserIdRef.current;
        if (!currentUserId) {
          logger.error('No userId available for session delete');
          return;
        }

        // Get dApp name before deletion
        const sessions = walletKit.getActiveSessions();
        const session = sessions[event.topic];
        const dappName = session?.peer.metadata?.name || 'Unknown';

        // Track session disconnection (initiated by dApp)
        trackWalletConnectSessionDisconnected({
          userId: currentUserId,
          topic: event.topic,
          dappName,
          initiatedBy: 'dapp',
        });

        try {
          await walletApi.disconnectWcSession(currentUserId, event.topic);
        } catch (err) {
          logger.warn('Failed to delete session from backend', {
            error: err instanceof Error ? err.message : 'Unknown error',
            topic: event.topic,
          });
        }

        setSessions(Object.values(walletKit.getActiveSessions()));
        metrics.increment('walletconnect.session.deleted');
      });

    } catch (err) {
      logger.error('WalletKit initialization failed', err);
      setError(err instanceof Error ? err.message : 'Failed to initialize WalletConnect');
      setIsInitializing(false);
      isInitializingGlobal = false;
      metrics.increment('walletconnect.init.failed');
    }
  }, [userId]);

  // Re-initialize when userId changes (e.g., after Google auth)
  useEffect(() => {
    if (!userId) {
      setIsInitializing(false);
      return;
    }

    // Update current userId ref
    currentUserIdRef.current = userId;

    // If userId changed, reset and re-initialize
    if (globalWalletKit && globalWalletKitUserId !== userId) {
      logger.log(`UserId changed from ${globalWalletKitUserId} to ${userId}, re-initializing WalletConnect`);
      globalWalletKit = null;
      globalWalletKitUserId = null;
      isInitializedRef.current = false;
      setClient(null);
      setSessions([]);
      // Re-initialize with new userId
      initialize().catch((err) => {
        logger.error('Failed to re-initialize WalletConnect after userId change', err);
      });
      return;
    }

    // Use existing client if userId matches
    if (globalWalletKit && globalWalletKitUserId === userId) {
      setClient(globalWalletKit);
      setIsInitializing(false);
      const existingSessions = globalWalletKit.getActiveSessions();
      setSessions(Object.values(existingSessions));
    } else {
      setIsInitializing(false);
    }
  }, [userId, initialize]);

  const pair = useCallback(async (uri: string) => {
    if (!client) {
      throw new Error('WalletKit not initialized');
    }

    if (!uri.startsWith('wc:')) {
      throw new Error('Invalid WalletConnect URI');
    }

    const currentUserId = currentUserIdRef.current;

    try {
      await client.pair({ uri });

      // Track pairing success
      trackWalletConnectPairingSuccess({
        userId: currentUserId || '',
        method: 'uri',
      });

      // Paired successfully
      metrics.increment('walletconnect.pair.success');
    } catch (err) {
      logger.error('Pairing failed', err);
      metrics.increment('walletconnect.pair.failed');
      throw err;
    }
  }, [client]);

  const disconnect = useCallback(async (topic: string) => {
    if (!client) {
      throw new Error('WalletKit not initialized');
    }

    const currentUserId = currentUserIdRef.current;

    // Get dApp name before disconnection
    const sessions = client.getActiveSessions();
    const session = sessions[topic];
    const dappName = session?.peer.metadata?.name || 'Unknown';

    try {
      await client.disconnectSession({
        topic,
        reason: {
          code: 6000,
          message: 'User disconnected',
        },
      });

      // Track user-initiated disconnection
      trackWalletConnectSessionDisconnected({
        userId: currentUserId || '',
        topic,
        dappName,
        initiatedBy: 'user',
      });

      // Also disconnect from backend
      try {
        await walletApi.disconnectWcSession(currentUserId || '', topic);
      } catch (err) {
        logger.warn('Failed to disconnect from backend', {
          error: err instanceof Error ? err.message : 'Unknown error',
          topic,
        });
      }

      setSessions(Object.values(client.getActiveSessions()));
      // Disconnected successfully
      metrics.increment('walletconnect.disconnect.success');
    } catch (err) {
      logger.error('Disconnect failed', err);
      metrics.increment('walletconnect.disconnect.failed');
      throw err;
    }
  }, [client]);

  const approveSession = useCallback(async (proposalId: number, namespaces: SessionTypes.Namespaces) => {
    if (!client) {
      throw new Error('WalletKit not initialized');
    }

    const currentUserId = currentUserIdRef.current;

    try {
      const { topic } = await client.approveSession({
        id: proposalId,
        namespaces,
      });

      const sessions = client.getActiveSessions();
      const session = sessions[topic];
      if (session) {
        await walletApi.saveWcSession(currentUserId || '', session, namespaces);
      }

      setSessions(Object.values(client.getActiveSessions()));
      metrics.increment('walletconnect.session.approved_manual');
    } catch (err) {
      logger.error('Approve session failed', err);
      metrics.increment('walletconnect.session.approve_failed_manual');
      throw err;
    }
  }, [client]);

  const rejectSession = useCallback(async (proposalId: number) => {
    if (!client) {
      throw new Error('WalletKit not initialized');
    }

    const currentUserId = currentUserIdRef.current;

    try {
      await walletApi.rejectWcProposal(currentUserId || '', proposalId);
      await client.rejectSession({
        id: proposalId,
        reason: {
          code: 5000,
          message: 'User rejected the connection',
        },
      });
      metrics.increment('walletconnect.session.rejected_manual');
    } catch (err) {
      logger.error('Reject session failed', err);
      metrics.increment('walletconnect.session.reject_failed');
      throw err;
    }
  }, [client]);

  return {
    client,
    sessions,
    isInitializing,
    error,
    pair,
    disconnect,
    approveSession,
    rejectSession,
    initialize,
  };
}
