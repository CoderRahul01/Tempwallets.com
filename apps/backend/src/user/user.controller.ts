import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { UserService } from './user.service.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { AwardXpDto } from './dto/award-xp.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { UserId } from '../auth/decorators/user-id.decorator.js';

@Controller('user')
@UseGuards(JwtAuthGuard)
export class UserController {
  private readonly logger = new Logger(UserController.name);

  constructor(private readonly userService: UserService) {}

  @Get('profile')
  async getProfile(@UserId() userId: string) {
    if (!userId) {
      throw new BadRequestException('User ID is required');
    }
    return this.userService.getProfile(userId);
  }

  @Patch('profile')
  async updateProfile(@UserId() userId: string, @Body() dto: UpdateProfileDto) {
    if (!userId) {
      throw new BadRequestException('User ID is required');
    }
    return this.userService.updateProfile(userId, dto);
  }

  @Get('stats')
  async getStats(@UserId() userId: string) {
    if (!userId) {
      throw new BadRequestException('User ID is required');
    }
    return this.userService.getUserStats(userId);
  }

  @Get('activity')
  async getActivity(@UserId() userId: string, @Query('limit') limit?: string) {
    if (!userId) {
      throw new BadRequestException('User ID is required');
    }
    const limitNum = limit ? parseInt(limit, 10) : 50;
    return this.userService.getUserActivity(userId, limitNum);
  }

  @Delete('account')
  @HttpCode(HttpStatus.OK)
  async deleteAccount(@UserId() userId: string) {
    if (!userId) {
      throw new BadRequestException('User ID is required');
    }
    return this.userService.deleteAccount(userId);
  }

  @Get('xp')
  async getXP(@UserId() userId: string) {
    if (!userId) {
      throw new BadRequestException('User ID is required');
    }
    return this.userService.getXP(userId);
  }

  @Post('xp/award')
  async awardXP(@UserId() userId: string, @Body() dto: AwardXpDto) {
    if (!userId) {
      throw new BadRequestException('User ID is required');
    }
    return this.userService.awardXP(userId, dto.amount, dto.reason);
  }
}
