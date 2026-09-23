import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../common/guards/roles.guard';
import { PaymentConfigService } from './payment-config.service';
import { UpdatePaymentConfigDto } from './dto/payment-config.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/payment-config')
export class PaymentConfigController {
  constructor(private paymentConfig: PaymentConfigService) {}

  // Ne renvoie jamais la clé API en clair — seulement si elle est configurée.
  @Get()
  get() {
    return this.paymentConfig.getMasked();
  }

  @Patch()
  update(@Body() dto: UpdatePaymentConfigDto) {
    return this.paymentConfig.update(dto);
  }
}
