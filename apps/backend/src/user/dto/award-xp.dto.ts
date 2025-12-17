import { IsNumber, IsString, IsNotEmpty, Min } from 'class-validator';

export class AwardXpDto {
  @IsNumber()
  @Min(1)
  @IsNotEmpty()
  amount: number;

  @IsString()
  @IsNotEmpty()
  reason: string;
}
