import { IsString, IsNotEmpty } from 'class-validator';

/**
 * DTO for Joining an Existing Lightning Node
 */
export class JoinLightningNodeDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsString()
  @IsNotEmpty()
  uri: string; // Lightning Node URI (lightning://...)
}
