import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../common/guards/roles.guard';
import { SmsConfigService } from './sms-config.service';
import { UpdateSmsConfigDto } from './dto/sms-config.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/sms-config')
export class SmsConfigController {
  constructor(private smsConfig: SmsConfigService) {}

  @Get()
  get() {
    return this.smsConfig.getMasked();
  }

  @Patch()
  update(@Body() dto: UpdateSmsConfigDto) {
    return this.smsConfig.update(dto);
  }
}
