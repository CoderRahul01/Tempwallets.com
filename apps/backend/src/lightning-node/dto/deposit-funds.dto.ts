import { IsString, IsNotEmpty, IsIn } from 'class-validator';

/**
 * DTO for Depositing Funds to Lightning Node
 */
export class DepositFundsDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsString()
  @IsNotEmpty()
  appSessionId: string; // Lightning Node session ID

  @IsString()
  @IsNotEmpty()
  amount: string; // Human-readable amount (e.g., "100.0")

  @IsString()
  @IsNotEmpty()
  asset: string; // USDC, USDT, etc.

  @IsString()
  @IsNotEmpty()
  participantAddress: string; // Depositor's address
}
