import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TournamentsService } from './tournaments.service';
import { CreateTournamentDto } from './dto/tournaments.dto';

@UseGuards(JwtAuthGuard)
@Controller('tournaments')
export class TournamentsController {
  constructor(private tournamentsService: TournamentsService) {}

  @Get()
  list(@Query('game') game?: string) {
    return this.tournamentsService.list(game);
  }

  @Get(':id')
  getDetail(@Param('id') id: string) {
    return this.tournamentsService.getDetail(id);
  }

  // N'importe quel joueur peut organiser un tournoi — pas réservé aux admins.
  @Post()
  create(@Req() req: any, @Body() dto: CreateTournamentDto) {
    return this.tournamentsService.create(req.user.userId, dto);
  }

  @Post(':id/join')
  join(@Req() req: any, @Param('id') id: string) {
    return this.tournamentsService.join(req.user.userId, id);
  }

  @Post(':id/start')
  start(@Req() req: any, @Param('id') id: string) {
    return this.tournamentsService.start(req.user.userId, id);
  }

  @Post(':id/cancel')
  cancel(@Req() req: any, @Param('id') id: string) {
    return this.tournamentsService.cancel(req.user.userId, id);
  }
}
