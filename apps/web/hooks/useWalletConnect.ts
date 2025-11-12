'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import SignClient from '@walletconnect/sign-client';
import { SessionTypes } from '@walletconnect/types';
import { walletApi, ApiError } from '@/lib/api';

export interface WalletConnectSession {
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

export interface UseWalletConnectReturn {
  client: SignClient | null;
  sessions: WalletConnectSession[];
  isInitializing: boolean;
  error: string | null;
  pair: (uri: string) => Promise<void>;
  disconnect: (topic: string) => Promise<void>;
  approveSession: (proposalId: number, namespaces: SessionTypes.Namespaces) => Promise<void>;
  rejectSession: (proposalId: number) => Promise<void>;
}

export function useWalletConnect(userId: string | null): UseWalletConnectReturn {
  const [client, setClient] = useState<SignClient | null>(null);
  const [sessions, setSessions] = useState<WalletConnectSession[]>([]);
  const [isInitializing, setIsInitializing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pendingProposalsRef = useRef<Map<number, any>>(new Map());

  // Initialize WalletConnect client
  useEffect(() => {
    if (!userId) {
      setIsInitializing(false);
      return;
    }

    const initClient = async () => {
      try {
        const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
        if (!projectId) {
          throw new Error('NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is not set in environment variables');
        }

        const signClient = await SignClient.init({
          projectId,
          metadata: {
            name: 'Tempwallets',
            description: 'Temporary wallet service',
            url: typeof window !== 'undefined' ? window.location.origin : 'https://tempwallets.com',
            icons: [`${typeof window !== 'undefined' ? window.location.origin : 'https://tempwallets.com'}/tempwallets-logo.png`],
          },
        });

        setClient(signClient);
        setIsInitializing(false);

        // Load existing sessions
        const existingSessions = signClient.session.getAll();
        setSessions(existingSessions.map(s => ({
          topic: s.topic,
          peer: s.peer,
          namespaces: s.namespaces,
        })));

        // Listen for session proposals
        signClient.on('session_proposal', async (event) => {
          console.log('WalletConnect session proposal received:', event);
          const { id, params } = event;
          pendingProposalsRef.current.set(id, params);
          
          // Log the full proposal structure for debugging
          console.log('Session proposal details:', {
            requiredNamespaces: params.requiredNamespaces,
            optionalNamespaces: params.optionalNamespaces,
            proposer: params.proposer,
            relays: params.relays,
          });
          
          // Auto-approve session proposals (you can add user confirmation UI here)
          try {
            // Fetch user addresses - ensure wallet is created first
            let addresses;
            try {
              addresses = await walletApi.getAddresses(userId);
            } catch (err) {
              // If addresses fail, try creating wallet first
              console.log('Addresses not found, creating wallet...');
              await walletApi.createOrImportSeed({ userId, mode: 'random' });
              // Wait a moment for wallet creation
              await new Promise(resolve => setTimeout(resolve, 1000));
              addresses = await walletApi.getAddresses(userId);
            }
            
            console.log('Fetched addresses for WalletConnect:', addresses);
            
            const namespaces: SessionTypes.Namespaces = {};
            const requestedChains: string[] = [];
            
            // Helper function to process a namespace (required or optional)
            const processNamespace = (namespaceKey: string, namespaceData: any, isRequired: boolean) => {
              // Get chains from the namespace - they might be in different formats
              let chains: string[] = [];
              
              if (namespaceData.chains && Array.isArray(namespaceData.chains)) {
                chains = namespaceData.chains;
              } else if (namespaceData.chains && typeof namespaceData.chains === 'string') {
                chains = [namespaceData.chains];
              } else if (namespaceData.accounts && Array.isArray(namespaceData.accounts)) {
                // Sometimes chains are embedded in accounts (e.g., "eip155:1:0x...")
                chains = namespaceData.accounts
                  .map((acc: string) => {
                    const parts = acc.split(':');
                    return parts.length >= 2 ? `${parts[0]}:${parts[1]}` : null;
                  })
                  .filter((c: string | null): c is string => c !== null);
              }
              
              // If no chains found and this is eip155 namespace, default to Ethereum mainnet
              if (chains.length === 0 && namespaceKey === 'eip155') {
                console.log('No chains specified for eip155 namespace, defaulting to Ethereum mainnet');
                chains = ['eip155:1'];
              }
              
              if (chains.length === 0) {
                console.warn(`No chains found for namespace ${namespaceKey}`, namespaceData);
                return;
              }
              
              console.log(`Processing ${isRequired ? 'required' : 'optional'} namespace ${namespaceKey} with chains:`, chains);
              
              // Map WalletConnect chain IDs to internal chain names and get addresses
              const accounts: string[] = [];
              
              chains.forEach((chain: string) => {
                requestedChains.push(chain);
                const chainParts = chain.split(':');
                if (chainParts.length < 2) {
                  console.warn(`Invalid chain format: ${chain}`);
                  return;
                }
                
                const chainId = chainParts[1];
                let address: string | null = null;
                
                // Map chain ID to internal chain name and get address
                switch (chainId) {
                  case '1': // Ethereum
                    address = addresses.ethereumErc4337 || addresses.ethereum;
                    break;
                  case '8453': // Base
                    address = addresses.baseErc4337 || addresses.base;
                    break;
                  case '42161': // Arbitrum
                    address = addresses.arbitrumErc4337 || addresses.arbitrum;
                    break;
                  case '137': // Polygon
                    address = addresses.polygonErc4337 || addresses.polygon;
                    break;
                  default:
                    console.warn(`Unsupported chain ID: ${chainId}`);
                    return;
                }
                
                if (address) {
                  accounts.push(`${chain}:${address}`);
                  console.log(`Mapped chain ${chain} (ID: ${chainId}) to address: ${address}`);
                } else {
                  console.warn(`No address found for chain ${chainId} (${chain}). Available addresses:`, {
                    ethereum: addresses.ethereum,
                    ethereumErc4337: addresses.ethereumErc4337,
                    base: addresses.base,
                    baseErc4337: addresses.baseErc4337,
                  });
                }
              });
              
              // Only add namespace if we have at least one account
              if (accounts.length > 0) {
                namespaces[namespaceKey] = {
                  accounts,
                  methods: namespaceData.methods || ['eth_sendTransaction', 'eth_signTransaction', 'eth_sign', 'personal_sign'],
                  events: namespaceData.events || ['chainChanged', 'accountsChanged'],
                };
                console.log(`Added namespace ${namespaceKey} with ${accounts.length} account(s)`);
              } else {
                console.warn(`No accounts found for namespace ${namespaceKey} (requested chains: ${chains.join(', ')})`);
              }
            };
            
            // Process required namespaces first
            if (params.requiredNamespaces) {
              Object.keys(params.requiredNamespaces).forEach((key) => {
                processNamespace(key, params.requiredNamespaces[key], true);
              });
            }
            
            // Process optional namespaces if no accounts were found in required namespaces
            if (Object.keys(namespaces).length === 0 && params.optionalNamespaces) {
              console.log('No accounts found in required namespaces, checking optional namespaces...');
              Object.keys(params.optionalNamespaces).forEach((key) => {
                // Only process if we haven't already added this namespace
                if (!namespaces[key]) {
                  processNamespace(key, params.optionalNamespaces[key], false);
                }
              });
            }

            // Validate that we have at least one namespace with accounts
            const hasValidNamespaces = Object.keys(namespaces).length > 0 && 
              Object.values(namespaces).some(ns => ns.accounts && ns.accounts.length > 0);

            if (!hasValidNamespaces) {
              const errorMsg = `No valid accounts found for requested chains: ${requestedChains.length > 0 ? requestedChains.join(', ') : 'none specified'}. Please ensure your wallet is initialized and has addresses for these chains.`;
              console.error(errorMsg, { 
                addresses, 
                requestedChains,
                requiredNamespaces: params.requiredNamespaces,
                optionalNamespaces: params.optionalNamespaces,
              });
              throw new Error(errorMsg);
            }

            // For now, auto-approve. In production, show confirmation UI
            await signClient.approve({
              id,
              namespaces,
            });

            pendingProposalsRef.current.delete(id);
          } catch (err) {
            console.error('Error approving session:', err);
            const errorMessage = err instanceof Error ? err.message : 'Failed to approve session';
            setError(errorMessage);
            
            // Reject the proposal if approval failed
            try {
              await signClient.reject({
                id,
                reason: {
                  code: 6001,
                  message: errorMessage,
                },
              });
            } catch (rejectErr) {
              console.error('Error rejecting session:', rejectErr);
            }
            
            pendingProposalsRef.current.delete(id);
          }
        });

        // Listen for session requests (transaction signing)
        signClient.on('session_request', async (event) => {
          console.log('WalletConnect session request received:', event);
          const { id, topic, params } = event;
          const { request } = params;
          const { method, params: requestParams } = request;

          try {
            if (method === 'eth_sendTransaction') {
              const tx = Array.isArray(requestParams) ? requestParams[0] : requestParams;
              
              if (!userId) {
                throw new Error('User ID is required');
              }

              // Get chain ID from the request
              const chainId = tx.chainId 
                ? (typeof tx.chainId === 'string' ? tx.chainId : `eip155:${tx.chainId}`)
                : 'eip155:1'; // Default to Ethereum

              // Call backend to sign transaction
              const result = await walletApi.signWalletConnectTransaction({
                userId,
                chainId,
                from: tx.from,
                to: tx.to,
                value: tx.value,
                data: tx.data,
                gas: tx.gas,
                gasPrice: tx.gasPrice,
                maxFeePerGas: tx.maxFeePerGas,
                maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
                nonce: tx.nonce,
              });

              const txHash = result.txHash;

              // Respond to WalletConnect with transaction hash
              await signClient.respond({
                topic,
                response: {
                  id,
                  jsonrpc: '2.0',
                  result: txHash,
                },
              });

              console.log('Transaction signed and sent:', txHash);
            } else {
              // Unsupported method
              await signClient.respond({
                topic,
                response: {
                  id,
                  jsonrpc: '2.0',
                  error: {
                    code: -32601,
                    message: `Method ${method} not supported`,
                  },
                },
              });
            }
          } catch (err) {
            console.error('Error handling session request:', err);
            
            // Send error response
            try {
              await signClient.respond({
                topic,
                response: {
                  id,
                  jsonrpc: '2.0',
                  error: {
                    code: -32000,
                    message: err instanceof Error ? err.message : 'Unknown error',
                  },
                },
              });
            } catch (respondError) {
              console.error('Error sending error response:', respondError);
            }
          }
        });

        // Listen for session deletions
        signClient.on('session_delete', () => {
          console.log('Session deleted');
          const updatedSessions = signClient.session.getAll();
          setSessions(updatedSessions.map(s => ({
            topic: s.topic,
            peer: s.peer,
            namespaces: s.namespaces,
          })));
        });
      } catch (err) {
        console.error('Error initializing WalletConnect:', err);
        setError(err instanceof Error ? err.message : 'Failed to initialize WalletConnect');
        setIsInitializing(false);
      }
    };

    initClient();
  }, [userId]);

  // Update sessions when client changes
  useEffect(() => {
    if (client) {
      const updateSessions = () => {
        const allSessions = client.session.getAll();
        setSessions(allSessions.map(s => ({
          topic: s.topic,
          peer: s.peer,
          namespaces: s.namespaces,
        })));
      };

      updateSessions();
      
      // Set up interval to check for session changes
      const interval = setInterval(updateSessions, 1000);
      return () => clearInterval(interval);
    }
  }, [client]);

  const pair = useCallback(async (uri: string) => {
    if (!client) {
      throw new Error('WalletConnect client not initialized');
    }

    try {
      setError(null);
      await client.pair({ uri });
      console.log('Successfully paired with DApp');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to pair with DApp';
      console.error('Error pairing:', err);
      setError(errorMessage);
      throw new Error(errorMessage);
    }
  }, [client]);

  const disconnect = useCallback(async (topic: string) => {
    if (!client) {
      throw new Error('WalletConnect client not initialized');
    }

    try {
      setError(null);
      await client.disconnect({
        topic,
        reason: {
          code: 6000,
          message: 'User disconnected',
        },
      });
      
      // Update sessions
      const updatedSessions = client.session.getAll();
      setSessions(updatedSessions.map(s => ({
        topic: s.topic,
        peer: s.peer,
        namespaces: s.namespaces,
      })));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to disconnect';
      console.error('Error disconnecting:', err);
      setError(errorMessage);
      throw new Error(errorMessage);
    }
  }, [client]);

  const approveSession = useCallback(async (proposalId: number, namespaces: SessionTypes.Namespaces) => {
    if (!client) {
      throw new Error('WalletConnect client not initialized');
    }

    try {
      setError(null);
      await client.approve({
        id: proposalId,
        namespaces,
      });
      pendingProposalsRef.current.delete(proposalId);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to approve session';
      console.error('Error approving session:', err);
      setError(errorMessage);
      throw new Error(errorMessage);
    }
  }, [client]);

  const rejectSession = useCallback(async (proposalId: number) => {
    if (!client) {
      throw new Error('WalletConnect client not initialized');
    }

    try {
      setError(null);
      await client.reject({
        id: proposalId,
        reason: {
          code: 6001,
          message: 'User rejected',
        },
      });
      pendingProposalsRef.current.delete(proposalId);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to reject session';
      console.error('Error rejecting session:', err);
      setError(errorMessage);
      throw new Error(errorMessage);
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
  };
}

