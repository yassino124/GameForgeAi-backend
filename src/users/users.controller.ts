import { Controller, Get, UseGuards, Request, Patch, Delete, Body } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';

@ApiTags('Users')
@Controller('users')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ 
    summary: 'Get current user profile', 
    description: 'Retrieve current user profile information' 
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Profile retrieved successfully' 
  })
  @ApiResponse({ 
    status: 401, 
    description: 'Unauthorized - invalid or missing token' 
  })
  @ApiResponse({ 
    status: 404, 
    description: 'User not found' 
  })
  async getProfile(@Request() req) {
    return this.usersService.getUserProfile(req.user.sub);
  }

  @Patch('me')
  @ApiOperation({ 
    summary: 'Update user profile', 
    description: 'Update current user profile information' 
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Profile updated successfully' 
  })
  @ApiResponse({ 
    status: 401, 
    description: 'Unauthorized' 
  })
  @ApiResponse({ 
    status: 400, 
    description: 'Bad request - validation errors' 
  })
  async updateProfile(@Request() req, @Body() updateData: any) {
    return this.usersService.updateProfile(req.user.sub, updateData);
  }

  @Delete('me')
  @ApiOperation({ 
    summary: 'Delete user account', 
    description: 'Delete current user account' 
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Account deleted successfully' 
  })
  @ApiResponse({ 
    status: 401, 
    description: 'Unauthorized' 
  })
  async deleteAccount(@Request() req) {
    return this.usersService.deleteAccount(req.user.sub);
  }
}
