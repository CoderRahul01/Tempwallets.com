import {
  IsString,
  IsArray,
  IsOptional,
  IsNumber,
  Min,
  Max,
  ArrayMinSize,
  ArrayMaxSize,
  IsNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * DTO for Creating a Lightning Node (App Session)
 */
export class CreateLightningNodeDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsArray()
  @IsOptional()
  @ArrayMinSize(0, { message: 'Participants must be a valid array' })
  @ArrayMaxSize(50, { message: 'Maximum 50 participants allowed' })
  @IsString({ each: true })
  participants?: string[]; // Ethereum addresses (optional - creator will be added automatically)

  @IsArray()
  @IsOptional()
  @IsNumber({}, { each: true })
  weights?: number[]; // Voting weights (defaults to equal if not provided)

  @IsNumber()
  @IsOptional()
  @Min(1)
  quorum?: number; // Minimum weight for approval (defaults to majority)

  @IsString()
  @IsNotEmpty()
  token: string; // USDC, USDT, etc.

  @IsString()
  @IsOptional()
  chain?: string; // ethereum, base, polygon (optional, defaults to user preference)

  @IsOptional()
  @Type(() => InitialAllocationDto)
  @IsArray()
  initialAllocations?: InitialAllocationDto[];

  @IsString()
  @IsOptional()
  sessionData?: string; // Application-specific state (JSON string)
}

export class InitialAllocationDto {
  @IsString()
  @IsNotEmpty()
  participant: string;

  @IsString()
  @IsNotEmpty()
  amount: string;
}
