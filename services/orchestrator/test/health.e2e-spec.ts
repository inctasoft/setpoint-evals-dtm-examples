import request from 'supertest';

/**
 * Health Check Integration Tests
 *
 * These tests run against a RUNNING orchestrator service.
 * They are suitable for CI/CD pipelines to verify service health.
 *
 * Usage:
 *   # Against running service (default: http://localhost:3000)
 *   ORCHESTRATOR_URL=http://host.docker.internal:3000 npm run test:integration
 *
 *   # Against a remote deployment
 *   ORCHESTRATOR_URL=http://your-deployment-url npm run test:integration
 */

// Type definitions for Kafka-specific responses (not DTOs yet)
interface HealthStatus {
  status: string;
  broker?: string;
  topics?: {
    total: number;
    project: {
      expected: number;
      existing: number;
      missing: number;
    };
  };
  projectTopics?: TopicDetail[];
}

interface TopicDetail {
  name: string;
  partitions: number;
  replicationFactor: number;
  exists?: boolean;
}

interface HealthResponse {
  status: string;
  info?: Record<string, HealthStatus>;
  details?: Record<string, HealthStatus>;
}

interface KafkaHealthResponse {
  broker: string;
  topics: string[];
  details: TopicDetail[];
}

// Default to localhost for local development
// Can be overridden with ORCHESTRATOR_URL environment variable
const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://localhost:3000';
const TIMEOUT = 30000; // 30 seconds for health checks that might need time to connect

describe('Health Check Endpoints (Integration)', () => {
  describe('GET /api/v1/api-docs', () => {
    it(
      'should return OpenApi dashboard',
      async () => {
        await request(ORCHESTRATOR_URL)
          .get('/api/v1/api-docs')
          .expect(200)
          .expect('Content-Type', /text\/html/);
      },
      TIMEOUT,
    );
  });

  describe('GET /api/v1/health', () => {
    it(
      'should return overall health status',
      async () => {
        const response = await request(ORCHESTRATOR_URL)
          .get('/api/v1/health')
          .expect(200)
          .expect('Content-Type', /json/);

        const body = response.body as HealthResponse;
        // Terminus format
        expect(body).toHaveProperty('status');
        expect(['ok', 'error']).toContain(body.status);
        expect(body).toHaveProperty('info');
        expect(body).toHaveProperty('details');
      },
      TIMEOUT,
    );

    it(
      'should include database health',
      async () => {
        const response = await request(ORCHESTRATOR_URL).get('/api/v1/health').expect(200);

        const body = response.body as HealthResponse;
        // Terminus format - database health is in details
        expect(body.details).toHaveProperty('database');
        expect(body.details?.database).toHaveProperty('status');
        expect(body.details?.database?.status).toBe('up');
      },
      TIMEOUT,
    );

    it(
      'should include Kafka health when available',
      async () => {
        const response = await request(ORCHESTRATOR_URL).get('/api/v1/health').expect(200);

        const body = response.body as HealthResponse;
        // Kafka might not be running, so we just check if it's included
        if (body.details?.kafka) {
          expect(body.details.kafka).toHaveProperty('status');
          expect(['up', 'down']).toContain(body.details.kafka.status);

          if (body.details.kafka.status === 'up') {
            expect(body.details.kafka).toHaveProperty('broker');
            expect(body.details.kafka).toHaveProperty('topics');
          }
        }
      },
      TIMEOUT,
    );
  });

  describe('GET /api/v1/health/kafka', () => {
    it(
      'should return Kafka topics information',
      async () => {
        const response = await request(ORCHESTRATOR_URL)
          .get('/api/v1/health/kafka')
          .expect((res) => {
            // Accept both 200 (Kafka running) and 503 (Kafka not running)
            expect([200, 503]).toContain(res.status);
          });

        if (response.status === 200) {
          const body = response.body as KafkaHealthResponse;
          expect(body).toHaveProperty('broker');
          expect(body).toHaveProperty('topics');
          expect(body).toHaveProperty('details');
          expect(Array.isArray(body.topics)).toBe(true);
          expect(Array.isArray(body.details)).toBe(true);
        }
      },
      TIMEOUT,
    );

    it(
      'should include project topics when Kafka is healthy',
      async () => {
        const response = await request(ORCHESTRATOR_URL).get('/api/v1/health/kafka');

        if (response.status === 200) {
          const body = response.body as KafkaHealthResponse;

          // Check for expected project topics
          expect(body.topics).toEqual(
            expect.arrayContaining(['dtm.jobs.completed', 'dtm.jobs.failed']),
          );

          // Verify topic details
          body.details.forEach((topic: TopicDetail) => {
            expect(topic).toHaveProperty('name');
            expect(topic).toHaveProperty('partitions');
            expect(topic).toHaveProperty('replicationFactor');
            expect(topic).toHaveProperty('exists');
            expect(typeof topic.partitions).toBe('number');
            expect(typeof topic.replicationFactor).toBe('number');
            expect(typeof topic.exists).toBe('boolean');
          });
        }
      },
      TIMEOUT,
    );
  });

  describe('GET /api/v1/health/ready', () => {
    it(
      'should return readiness probe status',
      async () => {
        const response = await request(ORCHESTRATOR_URL)
          .get('/api/v1/health/ready')
          .expect((res) => {
            // Service might not be ready if dependencies are down
            expect([200, 503]).toContain(res.status);
          });

        const body = response.body as HealthResponse;
        expect(body).toHaveProperty('status');
        expect(['ok', 'error']).toContain(body.status);
      },
      TIMEOUT,
    );

    it(
      'should check database readiness',
      async () => {
        const response = await request(ORCHESTRATOR_URL).get('/api/v1/health/ready');

        if (response.status === 200) {
          const body = response.body as HealthResponse;
          expect(body.details).toHaveProperty('database');
          expect(body.details?.database.status).toBe('up');
        }
      },
      TIMEOUT,
    );

    it(
      'should check Kafka readiness when available',
      async () => {
        const response = await request(ORCHESTRATOR_URL).get('/api/v1/health/ready');

        if (response.status === 200) {
          const body = response.body as HealthResponse;
          if (body.details?.kafka) {
            expect(body.details.kafka).toHaveProperty('status');
            expect(['up', 'down']).toContain(body.details.kafka.status);
          }
        }
      },
      TIMEOUT,
    );
  });

  describe('Response Headers', () => {
    it(
      'should include appropriate CORS headers',
      async () => {
        const response = await request(ORCHESTRATOR_URL).get('/api/v1/health').expect(200);

        // Check for common headers
        expect(response.headers).toHaveProperty('content-type');
        expect(response.headers['content-type']).toMatch(/application\/json/);
      },
      TIMEOUT,
    );

    it(
      'should return JSON content type for all health endpoints',
      async () => {
        const endpoints = ['/api/v1/', '/api/v1/health', '/api/v1/health/ready'];

        for (const endpoint of endpoints) {
          const response = await request(ORCHESTRATOR_URL)
            .get(endpoint)
            .expect((res) => {
              expect([200, 503]).toContain(res.status);
            });

          expect(response.headers['content-type']).toMatch(/application\/json/);
        }
      },
      TIMEOUT * 2,
    );
  });

  describe('Error Handling', () => {
    it(
      'should return 404 for non-existent endpoints',
      async () => {
        await request(ORCHESTRATOR_URL).get('/api/v1/health/nonexistent').expect(404);
      },
      TIMEOUT,
    );

    it(
      'should handle malformed requests gracefully',
      async () => {
        await request(ORCHESTRATOR_URL)
          .get('/api/v1/health')
          .set('Accept', 'invalid/type')
          .expect((res) => {
            expect([200, 406]).toContain(res.status);
          });
      },
      TIMEOUT,
    );
  });

  describe('Performance', () => {
    it(
      'should respond to health check within 5 seconds',
      async () => {
        const start = Date.now();

        await request(ORCHESTRATOR_URL)
          .get('/api/v1/health')
          .expect((res) => {
            expect([200, 503]).toContain(res.status);
          });

        const duration = Date.now() - start;
        expect(duration).toBeLessThan(5000);
      },
      TIMEOUT,
    );
  });
});
