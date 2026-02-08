import { Controller, Get, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('Admin')
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class AdminController {
  
  @Get('dashboard')
  @Roles('admin')
  @ApiOperation({ summary: 'Get admin dashboard' })
  @ApiResponse({ status: 200, description: 'Admin dashboard data' })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin access required' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  getAdminDashboard(@Request() req) {
    return {
      success: true,
      message: 'Welcome to admin dashboard',
      data: {
        user: {
          id: req.user.sub,
          email: req.user.email,
          username: req.user.username,
          role: req.user.role,
        },
        dashboard: {
          totalUsers: 150,
          activeProjects: 45,
          systemStatus: 'healthy',
        },
      },
    };
  }

  @Get('dev-tools')
  @Roles('admin', 'dev', 'devl')
  @ApiOperation({ summary: 'Get development tools' })
  @ApiResponse({ status: 200, description: 'Development tools accessible' })
  @ApiResponse({ status: 403, description: 'Forbidden - Dev or Admin access required' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  getDevTools(@Request() req) {
    return {
      success: true,
      message: 'Development tools access granted',
      data: {
        user: {
          id: req.user.sub,
          email: req.user.email,
          username: req.user.username,
          role: req.user.role,
        },
        tools: [
          'Database Manager',
          'API Documentation',
          'System Logs',
          'Performance Metrics',
        ],
      },
    };
  }
}
