import { Body, Controller, Get, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { UsersService } from './users.service';
import { UpdateDeviceInfoDto, AddGamingIdDto, SetAvatarDto } from './dto/users.dto';

@UseGuards(JwtAuthGuard)
@Controller('users/me')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get()
  getProfile(@Req() req: any) {
    return this.usersService.getProfile(req.user.userId);
  }

  @Patch()
  updateDeviceInfo(@Req() req: any, @Body() dto: UpdateDeviceInfoDto) {
    return this.usersService.updateDeviceInfo(req.user.userId, dto);
  }

  @Post('gaming-ids')
  addGamingId(@Req() req: any, @Body() dto: AddGamingIdDto) {
    return this.usersService.addGamingId(req.user.userId, dto);
  }

  @Patch('avatar')
  setAvatar(@Req() req: any, @Body() dto: SetAvatarDto) {
    return this.usersService.setAvatar(req.user.userId, dto.avatarId);
  }
}
