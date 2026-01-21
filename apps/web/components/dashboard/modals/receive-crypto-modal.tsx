"use client";

import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Copy, Check, X, Shield, Info } from 'lucide-react';
import { toast } from 'sonner';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@repo/ui/components/ui/dialog";
import { Button } from "@repo/ui/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/components/ui/tabs";
import { WalletData } from '@/hooks/useWalletV2';

interface ReceiveCryptoModalProps {
    isOpen: boolean;
    onClose: () => void;
    wallets: WalletData[];
    selectedChainId: string;
}

export function ReceiveCryptoModal({
    isOpen,
    onClose,
    wallets,
    selectedChainId,
}: ReceiveCryptoModalProps) {
    const [copied, setCopied] = useState(false);

    // Find the current wallet for the selected chain
    const currentWallet = wallets.find(w => w.chain === selectedChainId) || (wallets.length > 0 ? wallets[0] : null);

    // Categorize wallets for tabs
    const evmWallets = wallets.filter(w => w.chainType === 'evm');
    const substrateWallets = wallets.filter(w => w.chainType === 'substrate');
    const otherWallets = wallets.filter(w => w.chainType !== 'evm' && w.chainType !== 'substrate');

    const handleCopy = (address: string) => {
        navigator.clipboard.writeText(address);
        setCopied(true);
        toast.success("Address copied to clipboard");
        setTimeout(() => setCopied(false), 2000);
    };

    if (!currentWallet) return null;

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-md bg-[#1A1A1A] border-[#292929] text-white">
                <DialogHeader>
                    <div className="flex justify-between items-center">
                        <DialogTitle className="text-xl font-bold">Receive Assets</DialogTitle>
                    </div>
                </DialogHeader>

                <div className="flex flex-col items-center space-y-6 py-4">
                    {/* QR Code Section */}
                    <div className="bg-white p-4 rounded-2xl shadow-lg border-2 border-[#4C856F]/20">
                        <QRCodeSVG
                            value={currentWallet.address}
                            size={200}
                            level="H"
                            includeMargin={false}
                            className="rounded-lg"
                        />
                    </div>

                    {/* Address Display */}
                    <div className="w-full space-y-2">
                        <p className="text-sm text-gray-400 text-center">Your {currentWallet.name} Address</p>
                        <div className="flex items-center gap-2 p-3 bg-[#292929] rounded-xl border border-[#333] group">
                            <code className="flex-1 text-sm font-mono break-all text-center">
                                {currentWallet.address}
                            </code>
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleCopy(currentWallet.address)}
                                className="hover:bg-[#333] shrink-0"
                            >
                                {copied ? <Check className="h-4 w-4 text-[#4C856F]" /> : <Copy className="h-4 w-4 text-gray-400" />}
                            </Button>
                        </div>
                    </div>

                    {/* Warning/Info box */}
                    <div className="w-full p-4 bg-[#4C856F]/10 border border-[#4C856F]/20 rounded-xl flex gap-3 items-start">
                        <Info className="h-5 w-5 text-[#4C856F] shrink-0 mt-0.5" />
                        <div className="text-xs text-gray-300">
                            Only send <span className="text-white font-bold">{currentWallet.name}</span> compatible assets to this address. Sending assets from other networks may result in permanent loss of funds.
                        </div>
                    </div>

                    {/* Tabs for different chain types (if multiple wallets exist) */}
                    {wallets.length > 1 && (
                        <div className="w-full">
                            <p className="text-xs text-gray-500 mb-2 uppercase tracking-wider font-semibold">Other Network Addresses</p>
                            <div className="flex flex-wrap gap-2">
                                {wallets.filter(w => w.chain !== selectedChainId).slice(0, 3).map(wallet => (
                                    <Button
                                        key={wallet.chain}
                                        variant="outline"
                                        size="sm"
                                        className="text-[10px] h-7 bg-[#292929] border-[#333] hover:border-[#4C856F]/50"
                                        onClick={() => handleCopy(wallet.address)}
                                    >
                                        Copy {wallet.name}
                                    </Button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                <div className="flex justify-center pb-2">
                    <Button
                        variant="ghost"
                        onClick={onClose}
                        className="text-gray-400 hover:text-white"
                    >
                        Close
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
