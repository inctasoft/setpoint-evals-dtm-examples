import { ApiProperty } from '@nestjs/swagger';

export class LivenessDto {
  @ApiProperty({
    description: 'Service status',
    example: 'ok',
  })
  status: string;

  @ApiProperty({
    description: 'Timestamp of the check',
    example: '2025-01-01T00:00:00.000Z',
  })
  timestamp: string;
}
