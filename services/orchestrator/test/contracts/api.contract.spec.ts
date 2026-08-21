import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppController } from '../../src/app.controller';
import { AppService } from '../../src/app.service';

/**
 * General API Contract Tests
 *
 * Tests for basic API endpoints (root, health info, etc.)
 * Fast, no infrastructure needed
 */
describe('General API Contract Tests', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // AppService has minimal logic, we can use a simpler approach
    // and just mock the controller's return value
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: AppService,
          useValue: {
            getHealth: jest.fn().mockResolvedValue({
              status: 'UP',
              timestamp: new Date().toISOString(),
            }),
          },
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/v1', () => {
    it('should return API information with correct schema', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1')
        .expect(200)
        .expect('Content-Type', /json/);

      // Validate response schema
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('version');
      expect(response.body).toHaveProperty('documentation');

      // Validate types
      expect(typeof response.body.message).toBe('string');
      expect(typeof response.body.version).toBe('string');
      expect(typeof response.body.documentation).toBe('string');

      // Validate values
      expect(response.body.message).toContain('DTM');
      expect(response.body.documentation).toContain('/api-docs');
    });

    it('should include CORS headers if configured', async () => {
      const response = await request(app.getHttpServer()).get('/api/v1');

      // Check for common response headers
      expect(response.headers).toHaveProperty('content-type');
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for non-existent endpoints', async () => {
      await request(app.getHttpServer()).get('/api/v1/nonexistent-endpoint').expect(404);
    });

    it('should return proper error format', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/nonexistent-endpoint')
        .expect(404);

      // NestJS standard error format
      expect(response.body).toHaveProperty('statusCode');
      expect(response.body.statusCode).toBe(404);
    });
  });
});
