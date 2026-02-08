import { 
  Controller, 
  Post, 
  Get, 
  Put, 
  Patch,
  Delete,
  Body, 
  BadRequestException,
  UseGuards, 
  UseInterceptors,
  Request,
  HttpCode,
  HttpStatus,
  Param,
  UploadedFile,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { SessionsService } from './sessions.service';
import { RegisterDto, LoginDto, GoogleLoginDto } from './dto/auth.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { FileInterceptor } from '@nestjs/platform-express';

const { memoryStorage } = require('multer');

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly sessionsService: SessionsService,
  ) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new user' })
  @ApiResponse({ 
    status: 201, 
    description: 'User successfully registered',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'Registration successful' },
        data: {
          type: 'object',
          properties: {
            access_token: { 
              type: 'string', 
              example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
              description: 'JWT token - expires in 24h by default, 30d if rememberMe is true'
            },
            refresh_token: { 
              type: 'string', 
              example: 'refresh-token-here',
              description: 'Refresh token for token renewal'
            },
            user: {
              type: 'object',
              properties: {
                id: { type: 'string', example: '64f8a1b2c3d4e5f6a7b8c9d0' },
                email: { type: 'string', example: 'user@example.com' },
                username: { type: 'string', example: 'gamedev' },
                role: { type: 'string', example: 'user', enum: ['user', 'dev', 'devl', 'admin'] },
                subscription: { type: 'string', example: 'free' },
                avatar: { type: 'string', example: '' },
              },
            },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Bad Request - User already exists' })
  async register(@Request() req, @Body() registerDto: RegisterDto) {
    const deviceInfo = this.sessionsService.extractDeviceInfo(req);
    return this.authService.register(registerDto, deviceInfo.userAgent, deviceInfo.ipAddress);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login user' })
  @ApiResponse({ 
    status: 200, 
    description: 'Login successful',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'Login successful' },
        data: {
          type: 'object',
          properties: {
            access_token: { 
              type: 'string', 
              example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
              description: 'JWT token - expires in 24h by default, 30d if rememberMe is true'
            },
            refresh_token: { 
              type: 'string', 
              example: 'refresh-token-here',
              description: 'Refresh token for token renewal'
            },
            user: {
              type: 'object',
              properties: {
                id: { type: 'string', example: '64f8a1b2c3d4e5f6a7b8c9d0' },
                email: { type: 'string', example: 'user@example.com' },
                username: { type: 'string', example: 'gamedev' },
                role: { type: 'string', example: 'user', enum: ['user', 'dev', 'devl', 'admin'] },
                subscription: { type: 'string', example: 'free' },
                avatar: { type: 'string', example: '' },
              },
            },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized - Invalid credentials' })
  async login(@Request() req, @Body() loginDto: LoginDto) {
    const deviceInfo = this.sessionsService.extractDeviceInfo(req);
    return this.authService.login(loginDto, deviceInfo.userAgent, deviceInfo.ipAddress);
  }

  @Post('google/mobile')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Google login for mobile (ID token)' })
  async googleLoginMobile(@Request() req, @Body() googleLoginDto: GoogleLoginDto) {
    const deviceInfo = this.sessionsService.extractDeviceInfo(req);
    return this.authService.googleLoginWithIdToken(
      googleLoginDto,
      deviceInfo.userAgent,
      deviceInfo.ipAddress,
    );
  }

  @Get('profile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({ 
    status: 200, 
    description: 'Profile retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            user: {
              type: 'object',
              properties: {
                id: { type: 'string', example: '64f8a1b2c3d4e5f6a7b8c9d0' },
                email: { type: 'string', example: 'user@example.com' },
                username: { type: 'string', example: 'gamedev' },
                role: { type: 'string', example: 'user', enum: ['user', 'dev', 'devl', 'admin'] },
                subscription: { type: 'string', example: 'free' },
                avatar: { type: 'string', example: '' },
                projects: { type: 'array', items: { type: 'string' } },
                lastLogin: { type: 'string', example: '2024-01-28T20:00:00.000Z' },
              },
            },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getProfile(@Request() req) {
    return this.authService.getProfile(req.user.sub);
  }

  @Put('profile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update user profile' })
  @ApiResponse({ 
    status: 200, 
    description: 'Profile updated successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'Profile updated successfully' },
        data: {
          type: 'object',
          properties: {
            user: {
              type: 'object',
              properties: {
                id: { type: 'string', example: '64f8a1b2c3d4e5f6a7b8c9d0' },
                email: { type: 'string', example: 'user@example.com' },
                username: { type: 'string', example: 'gamedev' },
                role: { type: 'string', example: 'user', enum: ['user', 'dev', 'devl', 'admin'] },
                subscription: { type: 'string', example: 'free' },
                avatar: { type: 'string', example: '' },
              },
            },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 400, description: 'Bad Request - Username already taken' })
  async updateProfile(@Request() req, @Body() updateData: UpdateProfileDto) {
    return this.authService.updateProfile(req.user.sub, updateData);
  }

  @Patch('profile/avatar')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('avatar', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype?.startsWith('image/')) {
          return cb(new BadRequestException('Only image files are allowed'), false);
        }
        cb(null, true);
      },
    }),
  )
  async updateAvatar(@Request() req, @UploadedFile() file: any) {
    if (!file) {
      throw new BadRequestException('avatar file is required');
    }
    return this.authService.updateAvatar(req.user.sub, file);
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change password for the current user' })
  @ApiResponse({ status: 200, description: 'Password updated successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 400, description: 'Bad Request - Invalid current password' })
  async changePassword(@Request() req, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(req.user.sub, dto.currentPassword, dto.newPassword);
  }

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get active sessions' })
  @ApiResponse({ status: 200, description: 'Active sessions retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getActiveSessions(@Request() req) {
    return this.authService.getActiveSessions(req.user.sub);
  }

  @Delete('sessions/:sessionId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke a specific session' })
  @ApiResponse({ status: 200, description: 'Session revoked successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async revokeSession(@Request() req, @Param('sessionId') sessionId: string) {
    return this.authService.revokeSession(sessionId, req.user.sub);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'User logout' })
  @ApiResponse({ status: 200, description: 'Logout successful' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async logout(@Request() req) {
    return this.authService.logout(req.user.sub);
  }

  @Post('refresh-token')
  @ApiOperation({ summary: 'Refresh access token' })
  @ApiResponse({ status: 200, description: 'Token refreshed successfully' })
  @ApiResponse({ status: 401, description: 'Invalid refresh token' })
  async refreshToken(@Body() refreshTokenDto: RefreshTokenDto) {
    return this.authService.refreshToken(refreshTokenDto.refreshToken);
  }

  @Post('forgot-password')
  @ApiOperation({ summary: 'Request password reset' })
  @ApiResponse({ status: 200, description: 'Password reset email sent' })
  @ApiResponse({ status: 400, description: 'Invalid email address' })
  async forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    return this.authService.forgotPassword(forgotPasswordDto.email);
  }

  @Post('reset-password')
  @ApiOperation({ summary: 'Reset password' })
  @ApiResponse({ status: 200, description: 'Password reset successful' })
  @ApiResponse({ status: 400, description: 'Invalid or expired token' })
  async resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.authService.resetPassword(resetPasswordDto.token, resetPasswordDto.newPassword);
  }

  @Get('verify-email/:token')
  @ApiOperation({ summary: 'Verify email' })
  @ApiResponse({ status: 200, description: 'Email verified successfully' })
  @ApiResponse({ status: 400, description: 'Invalid or expired token' })
  async verifyEmail(@Param('token') token: string) {
    return this.authService.verifyEmail(token);
  }
}
