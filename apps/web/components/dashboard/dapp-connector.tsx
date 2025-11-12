'use client';

import { useState } from 'react';
import { useWalletConnect } from '@/hooks/useWalletConnect';
import { useBrowserFingerprint } from '@/hooks/useBrowserFingerprint';
import { Loader2, Link, X, ExternalLink, AlertCircle, QrCode } from 'lucide-react';
import { QRScanner } from './qr-scanner';

export function DAppConnector() {
  const { fingerprint } = useBrowserFingerprint();
  const { 
    sessions, 
    isInitializing, 
    error, 
    pair, 
    disconnect 
  } = useWalletConnect(fingerprint);
  
  const [uriInput, setUriInput] = useState('');
  const [isPairing, setIsPairing] = useState(false);
  const [pairError, setPairError] = useState<string | null>(null);
  const [showQRScanner, setShowQRScanner] = useState(false);

  const handlePair = async () => {
    if (!uriInput.trim()) {
      setPairError('Please enter a WalletConnect URI');
      return;
    }

    if (!uriInput.startsWith('wc:')) {
      setPairError('Invalid WalletConnect URI. Must start with "wc:"');
      return;
    }

    setIsPairing(true);
    setPairError(null);

    try {
      await pair(uriInput);
      setUriInput(''); // Clear input on success
    } catch (err) {
      setPairError(err instanceof Error ? err.message : 'Failed to connect to DApp');
    } finally {
      setIsPairing(false);
    }
  };

  const handleDisconnect = async (topic: string) => {
    try {
      await disconnect(topic);
    } catch (err) {
      console.error('Error disconnecting:', err);
    }
  };

  const handleQRScan = async (scannedUri: string) => {
    setShowQRScanner(false);
    setUriInput(scannedUri);
    // Auto-connect after scanning
    setIsPairing(true);
    setPairError(null);
    try {
      await pair(scannedUri);
      setUriInput('');
    } catch (err) {
      setPairError(err instanceof Error ? err.message : 'Failed to connect to DApp');
    } finally {
      setIsPairing(false);
    }
  };

  if (isInitializing) {
    return (
      <div className="w-full max-w-2xl mx-auto p-6 bg-white/10 backdrop-blur-sm rounded-2xl border border-white/20">
        <div className="flex items-center justify-center space-x-2 text-white">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Initializing WalletConnect...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl mx-auto p-6 bg-white/10 backdrop-blur-sm rounded-2xl border border-white/20">
      <h3 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
        <Link className="h-5 w-5" />
        Connect to DApp
      </h3>

      {/* Error Display */}
      {(error || pairError) && (
        <div className="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-lg flex items-start gap-2">
          <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-red-200 text-sm">{error || pairError}</p>
        </div>
      )}

      {/* URI Input */}
      <div className="mb-6">
        <label htmlFor="wc-uri" className="block text-sm font-medium text-white/80 mb-2">
          WalletConnect URI
        </label>
        <div className="flex gap-2">
          <textarea
            id="wc-uri"
            placeholder="Paste WalletConnect URI here (wc://...) or scan QR code"
            value={uriInput}
            onChange={(e) => {
              setUriInput(e.target.value);
              setPairError(null);
            }}
            className="flex-1 px-4 py-2 bg-white/5 border border-white/20 rounded-lg text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/30 resize-none"
            rows={3}
          />
          <div className="flex flex-col gap-2">
            <button
              onClick={() => setShowQRScanner(true)}
              className="px-4 py-2 bg-white/20 hover:bg-white/30 text-white rounded-lg transition-colors flex items-center justify-center gap-2"
              title="Scan QR Code"
            >
              <QrCode className="h-5 w-5" />
            </button>
            <button
              onClick={handlePair}
              disabled={isPairing || !uriInput.trim()}
              className="px-4 py-2 bg-white/20 hover:bg-white/30 disabled:bg-white/10 disabled:cursor-not-allowed text-white rounded-lg transition-colors flex items-center gap-2"
            >
              {isPairing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="hidden sm:inline">Connecting...</span>
                </>
              ) : (
                <>
                  <Link className="h-4 w-4" />
                  <span className="hidden sm:inline">Connect</span>
                </>
              )}
            </button>
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <p className="text-xs text-white/60">
            Paste URI or scan QR code to connect
          </p>
          <button
            onClick={() => setShowQRScanner(true)}
            className="text-xs text-white/80 hover:text-white flex items-center gap-1 underline"
          >
            <QrCode className="h-3 w-3" />
            Scan QR Code
          </button>
        </div>
      </div>

      {/* QR Scanner Modal */}
      {showQRScanner && (
        <QRScanner
          onScan={handleQRScan}
          onClose={() => setShowQRScanner(false)}
        />
      )}

      {/* Active Sessions */}
      {sessions.length > 0 && (
        <div>
          <h4 className="text-lg font-medium text-white mb-3">Connected DApps</h4>
          <div className="space-y-3">
            {sessions.map((session) => (
              <div
                key={session.topic}
                className="p-4 bg-white/5 border border-white/20 rounded-lg flex items-start justify-between gap-4"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {session.peer.metadata?.icons && session.peer.metadata.icons.length > 0 && (
                      <img
                        src={session.peer.metadata.icons[0]}
                        alt={session.peer.metadata.name || 'DApp'}
                        className="h-6 w-6 rounded"
                      />
                    )}
                    <h5 className="font-medium text-white truncate">
                      {session.peer.metadata?.name || 'Unknown DApp'}
                    </h5>
                  </div>
                  {session.peer.metadata?.description && (
                    <p className="text-sm text-white/60 line-clamp-2 mb-2">
                      {session.peer.metadata.description}
                    </p>
                  )}
                  {session.peer.metadata?.url && (
                    <a
                      href={session.peer.metadata.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-white/80 hover:text-white flex items-center gap-1"
                    >
                      <ExternalLink className="h-3 w-3" />
                      {session.peer.metadata.url}
                    </a>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {Object.keys(session.namespaces).map((namespace) => (
                      <span
                        key={namespace}
                        className="px-2 py-1 bg-white/10 rounded text-xs text-white/80"
                      >
                        {namespace}
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  onClick={() => handleDisconnect(session.topic)}
                  className="p-2 hover:bg-white/10 rounded-lg transition-colors text-white/80 hover:text-white"
                  title="Disconnect"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {sessions.length === 0 && (
        <div className="text-center py-8 text-white/60">
          <p>No DApps connected</p>
          <p className="text-sm mt-2">Paste a WalletConnect URI above to get started</p>
        </div>
      )}
    </div>
  );
}

