import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { DuelsService } from './duels.service';
import { CreateDuelDto, JoinDuelDto } from './dto/duels.dto';

@UseGuards(JwtAuthGuard)
@Controller('duels')
export class DuelsController {
  constructor(private duelsService: DuelsService) {}

  @Get()
  list(@Query('game') game?: string) {
    return this.duelsService.listOpen(game);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.duelsService.get(id);
  }

  @Post()
  create(@Req() req: any, @Body() dto: CreateDuelDto) {
    return this.duelsService.create(req.user.userId, dto);
  }

  @Post(':id/join')
  join(@Req() req: any, @Param('id') id: string, @Body() dto: JoinDuelDto) {
    return this.duelsService.join(req.user.userId, id, dto);
  }

  @Post(':id/start')
  start(@Param('id') id: string) {
    return this.duelsService.start(id);
  }

  @Post(':id/cancel')
  cancel(@Req() req: any, @Param('id') id: string) {
    return this.duelsService.cancel(id, req.user.userId);
  }
}
