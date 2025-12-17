import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

/**
 * DTO for Authenticating a User's Wallet with Yellow Network
 */
export class AuthenticateWalletDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsString()
  @IsOptional()
  chain?: string; // ethereum, base, polygon (optional, defaults to base)
}
