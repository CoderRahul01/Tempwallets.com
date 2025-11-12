import { IsString, IsNotEmpty, IsIn, IsOptional, ValidateIf, Matches } from 'class-validator';

export class CreateOrImportSeedDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsString()
  @IsIn(['random', 'mnemonic'])
  mode: 'random' | 'mnemonic';

  @IsString()
  @IsOptional()
  @ValidateIf((o) => o.mode === 'mnemonic')
  @IsNotEmpty()
  mnemonic?: string;
}

const SUPPORTED_CHAINS = [
  'ethereum',
  'tron',
  'bitcoin',
  'solana',
  'ethereumErc4337',
  'baseErc4337',
  'arbitrumErc4337',
  'polygonErc4337',
] as const;

export class SendCryptoDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsString()
  @IsIn(SUPPORTED_CHAINS)
  chain: string;

  @IsString()
  @IsOptional()
  tokenAddress?: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^[0-9]+(\.[0-9]+)?$/, { message: 'Amount must be a positive number' })
  amount: string;

  @IsString()
  @IsNotEmpty()
  recipientAddress: string;
}

export class WalletConnectSignDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsString()
  @IsNotEmpty()
  chainId: string; // eip155:1, eip155:8453, etc.

  @IsString()
  @IsNotEmpty()
  from: string;

  @IsString()
  @IsOptional()
  to?: string;

  @IsString()
  @IsOptional()
  value?: string;

  @IsString()
  @IsOptional()
  data?: string;

  @IsString()
  @IsOptional()
  gas?: string;

  @IsString()
  @IsOptional()
  gasPrice?: string;

  @IsString()
  @IsOptional()
  maxFeePerGas?: string;

  @IsString()
  @IsOptional()
  maxPriorityFeePerGas?: string;

  @IsString()
  @IsOptional()
  nonce?: string;
}

