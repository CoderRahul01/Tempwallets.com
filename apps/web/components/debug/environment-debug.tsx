'use client';

import { useState, useEffect } from 'react';
import { Card } from '@repo/ui/components/ui/card';
import { Button } from '@repo/ui/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { useBrowserFingerprint } from '@/hooks/useBrowserFingerprint';

export function EnvironmentDebug() {
  const { userId, user, isAuthenticated } = useAuth();
  const { fingerprint, loading: fpLoading } = useBrowserFingerprint();
  const [apiStatus, setApiStatus] = useState<'checking' | 'ok' | 'error'>('checking');
  const [apiUrl, setApiUrl] = useState<string>('');
  const [backendConfig, setBackendConfig] = useState<any>(null);

  useEffect(() => {
    const checkApi = async () => {
      const url = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:5005';
      setApiUrl(url);

      try {
        const response = await fetch(`${url}/debug/config`);
        if (response.ok) {
          const data = await response.json();
          setBackendConfig(data);
          setApiStatus('ok');
        } else {
          setApiStatus('error');
        }
      } catch (error) {
        console.error('API check failed:', error);
        setApiStatus('error');
      }
    };

    checkApi();
  }, []);

  const localStorageWalletId = typeof window !== 'undefined'
    ? localStorage.getItem('temp_wallet_id')
    : null;

  return (
    <div className="p-6 space-y-4 max-w-4xl mx-auto">
      <Card className="p-6">
        <h2 className="text-2xl font-bold mb-4">Environment Diagnostics</h2>

        {/* User ID Status */}
        <div className="mb-6">
          <h3 className="text-lg font-semibold mb-2">User ID Status</h3>
          <div className="space-y-2 text-sm font-mono">
            <div className="flex justify-between">
              <span>Current userId:</span>
              <span className={userId ? 'text-green-600' : 'text-red-600'}>
                {userId || 'NOT_SET'}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Authenticated:</span>
              <span className={isAuthenticated ? 'text-green-600' : 'text-yellow-600'}>
                {isAuthenticated ? 'Yes' : 'No'}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Google User ID:</span>
              <span className={user?.id ? 'text-green-600' : 'text-gray-500'}>
                {user?.id || 'Not signed in'}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Fingerprint:</span>
              <span className={fingerprint ? 'text-green-600' : 'text-red-600'}>
                {fpLoading ? 'Loading...' : (fingerprint || 'FAILED')}
              </span>
            </div>
            <div className="flex justify-between">
              <span>LocalStorage wallet_id:</span>
              <span className={localStorageWalletId ? 'text-green-600' : 'text-red-600'}>
                {localStorageWalletId || 'NOT_SET'}
              </span>
            </div>
          </div>
        </div>

        {/* Browser Environment */}
        <div className="mb-6">
          <h3 className="text-lg font-semibold mb-2">Browser Environment</h3>
          <div className="space-y-2 text-sm font-mono">
            <div className="flex justify-between">
              <span>localStorage available:</span>
              <span className={typeof window !== 'undefined' && window.localStorage ? 'text-green-600' : 'text-red-600'}>
                {typeof window !== 'undefined' && window.localStorage ? 'Yes' : 'No'}
              </span>
            </div>
            <div className="flex justify-between">
              <span>User Agent:</span>
              <span className="text-xs truncate max-w-xs">
                {typeof window !== 'undefined' ? navigator.userAgent : 'N/A'}
              </span>
            </div>
          </div>
        </div>

        {/* API Connection */}
        <div className="mb-6">
          <h3 className="text-lg font-semibold mb-2">API Connection</h3>
          <div className="space-y-2 text-sm font-mono">
            <div className="flex justify-between">
              <span>API URL:</span>
              <span className="text-blue-600">{apiUrl}</span>
            </div>
            <div className="flex justify-between">
              <span>Connection Status:</span>
              <span className={
                apiStatus === 'ok' ? 'text-green-600' :
                  apiStatus === 'error' ? 'text-red-600' :
                    'text-yellow-600'
              }>
                {apiStatus === 'ok' ? 'Connected' :
                  apiStatus === 'error' ? 'Failed' :
                    'Checking...'}
              </span>
            </div>
          </div>
        </div>

        {/* Backend Config */}
        {backendConfig && (
          <div className="mb-6">
            <h3 className="text-lg font-semibold mb-2">Backend Configuration</h3>
            <div className="space-y-2 text-sm font-mono">
              <div className="flex justify-between">
                <span>Environment:</span>
                <span>{backendConfig.environment}</span>
              </div>
              <div className="flex justify-between">
                <span>Zerion API Key:</span>
                <span className={backendConfig.config.zerionApiKey === 'NOT_SET' ? 'text-red-600' : 'text-green-600'}>
                  {backendConfig.config.zerionApiKey}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Frontend URL:</span>
                <span className={backendConfig.config.frontendUrl === 'NOT_SET' ? 'text-yellow-600' : 'text-green-600'}>
                  {backendConfig.config.frontendUrl}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Database:</span>
                <span className={backendConfig.config.databaseUrl === 'NOT_SET' ? 'text-red-600' : 'text-green-600'}>
                  {backendConfig.config.databaseUrl}
                </span>
              </div>
            </div>

            {backendConfig.warnings && backendConfig.warnings.length > 0 && (
              <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded">
                <h4 className="font-semibold text-red-800 mb-2">Configuration Warnings:</h4>
                <ul className="list-disc list-inside text-sm text-red-700">
                  {backendConfig.warnings.map((warning: string, i: number) => (
                    <li key={i}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Test Actions */}
        <div>
          <h3 className="text-lg font-semibold mb-2">Test Actions</h3>
          <div className="space-y-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (typeof window !== 'undefined') {
                  localStorage.removeItem('temp_wallet_id');
                  window.location.reload();
                }
              }}
            >
              Clear LocalStorage & Reload
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  const response = await fetch(`${apiUrl}/health`);
                  const data = await response.json();
                  console.log('Health check:', data);
                  alert(`Health check: ${JSON.stringify(data, null, 2)}`);
                } catch (error) {
                  alert(`Health check failed: ${error}`);
                }
              }}
            >
              Test /health Endpoint
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
