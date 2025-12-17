import { IsString, IsNotEmpty } from 'class-validator';

/**
 * DTO for Closing a Lightning Node
 */
export class CloseLightningNodeDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsString()
  @IsNotEmpty()
  appSessionId: string; // Lightning Node session ID
}
