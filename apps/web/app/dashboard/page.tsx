"use client";

import UpperBar from "@/components/dashboard/upper-bar";
import WalletInfo from "@/components/dashboard/wallet-info";
import RecentTransactions from "@/components/dashboard/recent-transactions";

export default function DashboardPage() {
  return (
    <div className="min-h-screen">
      {/* Upper Bar - Mobile Only */}
      <UpperBar />

      {/* Main Content with padding for wallet info */}
      <div className="pt-16 lg:pt-20 py-8 px-4 sm:px-6 lg:px-8">
        <WalletInfo />
      </div>
      
      {/* Recent Transactions - Full width on mobile, constrained on desktop */}
      <RecentTransactions />
    </div>
  );
}

