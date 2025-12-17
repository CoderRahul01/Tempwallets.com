import { IsString, IsNotEmpty } from 'class-validator';

/**
 * DTO for Transferring Funds Within Lightning Node (Gasless)
 */
export class TransferFundsDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsString()
  @IsNotEmpty()
  appSessionId: string; // Lightning Node session ID

  @IsString()
  @IsNotEmpty()
  fromAddress: string; // Sender address

  @IsString()
  @IsNotEmpty()
  toAddress: string; // Recipient address

  @IsString()
  @IsNotEmpty()
  amount: string; // Human-readable amount

  @IsString()
  @IsNotEmpty()
  asset: string; // USDC, USDT, etc.
}
