import { Controller, Get, Patch, Param, Body, UseGuards, Req, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { NotificationsService } from './notifications.service';

@ApiTags('Notifications')
@Controller('notifications')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'List current user notifications' })
  async list(@Req() req: any) {
    return this.notificationsService.listForUser(req.user.sub);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Mark a notification read/unread' })
  async markRead(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const isRead = body?.isRead === false ? false : true;
    return this.notificationsService.markRead({ userId: req.user.sub, notificationId: id, isRead });
  }

  @Post('read-all')
  @ApiOperation({ summary: 'Mark all notifications as read' })
  async markAllRead(@Req() req: any) {
    return this.notificationsService.markAllRead(req.user.sub);
  }

  @Post('clear-all')
  @ApiOperation({ summary: 'Clear all notifications' })
  async clearAll(@Req() req: any) {
    return this.notificationsService.clearAll(req.user.sub);
  }
}
