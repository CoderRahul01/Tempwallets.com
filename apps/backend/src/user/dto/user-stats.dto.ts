export class UserStatsDto {
  walletCount: number;
  transactionCount: number;
  totalBalance: string; // Total balance across all chains (in smallest units)
  activeWallets: number;
  createdAt: Date;
  lastLoginAt: Date;
}
