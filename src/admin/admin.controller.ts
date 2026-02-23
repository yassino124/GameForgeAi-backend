import { Controller, Get, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserSchema } from '../users/entities/user.entity';
import { GameProject } from '../projects/schemas/game-project.schema';
import { UnityTemplate } from '../templates/schemas/unity-template.schema';

@ApiTags('Admin')
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class AdminController {
  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<User>,
    @InjectModel(GameProject.name)
    private readonly projectModel: Model<GameProject>,
    @InjectModel(UnityTemplate.name)
    private readonly templateModel: Model<UnityTemplate>,
  ) {}
  
  @Get('dashboard')
  @Roles('admin')
  @ApiOperation({ summary: 'Get admin dashboard' })
  @ApiResponse({ status: 200, description: 'Admin dashboard data' })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin access required' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getAdminDashboard(@Request() req) {
    // Calculate total users
    const totalUsers = await this.userModel.countDocuments();
    
    // Calculate users from last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const usersLast30Days = await this.userModel.aggregate([
      {
        $match: {
          createdAt: { $gte: thirtyDaysAgo }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Calculate previous month users for change percentage
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
    const previousMonthUsers = await this.userModel.countDocuments({
      createdAt: { $gte: sixtyDaysAgo, $lt: thirtyDaysAgo }
    });
    
    const currentMonthUsers = usersLast30Days.reduce((sum, day) => sum + day.count, 0);
    const totalUsersChange = previousMonthUsers === 0 
      ? '+100%' 
      : `+${((currentMonthUsers - previousMonthUsers) / previousMonthUsers * 100).toFixed(1)}%`;

    const response = {
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
          totalUsers,
          totalUsersChange,
          newUsersLast30Days: usersLast30Days,
          activeProjects: 45,
          systemStatus: 'healthy',
        },
      },
    };
    return response;
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

  @Get('projects')
  @Roles('admin')
  @ApiOperation({ summary: 'Get all projects with enriched data' })
  @ApiResponse({ status: 200, description: 'All projects with owner and template details' })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin access required' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getAdminProjects() {
    try {
      // 1. Fetch all projects
      const projects = await this.projectModel.find().lean().exec();

      if (!projects || projects.length === 0) {
        return {
          success: true,
          data: [],
        };
      }

      // 2. Get unique owner IDs and fetch users
      const uniqueOwnerIds = [...new Set(projects.map(p => p.ownerId.toString()))];
      const owners = await this.userModel.find(
        { _id: { $in: uniqueOwnerIds } },
        { _id: 1, username: 1, email: 1 }
      ).lean().exec();
      
      const ownerMap = new Map();
      owners.forEach(owner => {
        ownerMap.set(owner._id.toString(), `${owner.username} (${owner.email})`);
      });

      // 3. Get unique template IDs and fetch templates
      const uniqueTemplateIds = [...new Set(projects.map(p => p.templateId.toString()))];
      const templates = await this.templateModel.find(
        { _id: { $in: uniqueTemplateIds } },
        { _id: 1, name: 1 }
      ).lean().exec();
      
      const templateMap = new Map();
      templates.forEach(template => {
        templateMap.set(template._id.toString(), template.name);
      });

      // 4. Enrich projects with owner and template names
      const enrichedProjects = projects.map(project => ({
        ...project,
        ownerDisplay: ownerMap.get(project.ownerId.toString()) || project.ownerId.toString(),
        templateName: templateMap.get(project.templateId.toString()) || project.templateId.toString(),
      }));

      return {
        success: true,
        data: enrichedProjects,
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to fetch projects',
        error: error.message,
      };
    }
  }
}
