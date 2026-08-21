import { ApiProperty } from '@nestjs/swagger';

export class ApiInfoDto {
  @ApiProperty({
    description: 'Welcome message',
    example: 'Welcome to DTM Orchestrator API',
  })
  message: string;

  @ApiProperty({
    description: 'API version',
    example: '1.0',
  })
  version: string;

  @ApiProperty({
    description: 'API documentation URL',
    example: '/api-docs',
  })
  documentation: string;

  @ApiProperty({
    description: 'Monitor dashboard URL',
    example: 'http://localhost:5173',
  })
  dashboard: string;
}
