import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { UserStatsDto } from './dto/user-stats.dto.js';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(private prisma: PrismaService) {}

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        picture: true,
        googleId: true,
        createdAt: true,
        lastLoginAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.picture !== undefined && { picture: dto.picture }),
      },
      select: {
        id: true,
        email: true,
        name: true,
        picture: true,
        googleId: true,
        createdAt: true,
        lastLoginAt: true,
      },
    });

    this.logger.log(`User ${userId} updated profile`);
    return updatedUser;
  }

  async getUserStats(userId: string): Promise<UserStatsDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        wallets: {
          include: {
            addresses: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Count wallets
    const walletCount = user.wallets.length;
    const activeWallets = walletCount; // All wallets are considered active for now

    // Count transactions (we'll need to query transaction logs if they exist)
    // For now, we'll use a placeholder
    const transactionCount = 0; // TODO: Implement transaction counting

    // Calculate total balance (placeholder - would need to aggregate from balances)
    const totalBalance = '0'; // TODO: Implement balance aggregation

    return {
      walletCount,
      transactionCount,
      totalBalance,
      activeWallets,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
    };
  }

  async getUserActivity(userId: string, limit: number = 50) {
    // For now, return basic activity based on user data
    // In the future, this will query UserActivity model
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        wallets: {
          orderBy: { createdAt: 'desc' },
          take: limit,
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const activities = [
      {
        id: 'account-created',
        type: 'account_created',
        description: 'Account created',
        timestamp: user.createdAt,
        metadata: {},
      },
      {
        id: 'last-login',
        type: 'login',
        description: 'Last login',
        timestamp: user.lastLoginAt,
        metadata: {},
      },
      ...user.wallets.map((wallet) => ({
        id: `wallet-${wallet.id}`,
        type: 'wallet_created',
        description: 'Wallet created',
        timestamp: wallet.createdAt,
        metadata: { walletId: wallet.id },
      })),
    ].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    return activities.slice(0, limit);
  }

  async deleteAccount(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Prisma will cascade delete wallets and related data
    await this.prisma.user.delete({
      where: { id: userId },
    });

    this.logger.log(`User ${userId} account deleted`);
    return { success: true };
  }

  async getXP(userId: string): Promise<{ xp: number }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { xp: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return { xp: user.xp || 0 };
  }

  async awardXP(
    userId: string,
    amount: number,
    reason: string,
  ): Promise<{ xp: number; totalXP: number }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { xp: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const currentXP = user.xp || 0;
    const newXP = currentXP + amount;

    await this.prisma.user.update({
      where: { id: userId },
      data: { xp: newXP },
    });

    // Log activity
    await this.prisma.userActivity.create({
      data: {
        userId,
        type: 'xp_awarded',
        description: `Awarded ${amount} XP: ${reason}`,
        metadata: { amount, reason, previousXP: currentXP, newXP },
      },
    });

    this.logger.log(
      `User ${userId} awarded ${amount} XP (${reason}). Total: ${newXP}`,
    );
    return { xp: amount, totalXP: newXP };
  }
}
