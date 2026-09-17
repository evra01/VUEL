import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../common/guards/roles.guard';
import { DisputesService } from './disputes.service';
import { CreateDisputeDto, ResolveDisputeDto } from './dto/disputes.dto';

@UseGuards(JwtAuthGuard)
@Controller('disputes')
export class DisputesController {
  constructor(private disputesService: DisputesService) {}

  @Post()
  report(@Req() req: any, @Body() dto: CreateDisputeDto) {
    return this.disputesService.report(req.user.userId, dto);
  }
}

// Endpoints réservés au back-office arbitrage
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'ARBITER')
@Controller('admin/disputes')
export class AdminDisputesController {
  constructor(private disputesService: DisputesService) {}

  @Get()
  list() {
    return this.disputesService.listOpen();
  }

  @Get(':id')
  getCaseFile(@Param('id') id: string) {
    return this.disputesService.getCaseFile(id);
  }

  @Post(':id/resolve')
  resolve(@Req() req: any, @Param('id') id: string, @Body() dto: ResolveDisputeDto) {
    return this.disputesService.resolve(id, req.user.userId, dto);
  }
}
