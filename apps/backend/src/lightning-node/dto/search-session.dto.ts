import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

/**
 * DTO for Searching a Specific Lightning Node Session
 */
export class SearchSessionDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsString()
  @IsNotEmpty()
  sessionId: string; // App session ID (0x-prefixed hex)

  @IsString()
  @IsOptional()
  chain?: string; // Chain where the session exists (optional, will try to detect)
}
