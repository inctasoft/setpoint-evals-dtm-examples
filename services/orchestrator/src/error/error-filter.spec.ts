import { GlobalErrorFilter } from './error-filter';
import {
  AppError,
  ErrorCode,
  HttpException,
  ValidationException,
  NotFoundException,
} from './error';
import { HttpException as NestHttpException, HttpStatus, Logger } from '@nestjs/common';
import { ArgumentsHost } from '@nestjs/common';

describe('GlobalErrorFilter', () => {
  let filter: GlobalErrorFilter;
  let mockArgumentsHost: ArgumentsHost;
  let mockResponse: any;
  let mockRequest: any;
  let loggerErrorSpy: jest.SpyInstance;
  let loggerWarnSpy: jest.SpyInstance;

  beforeEach(() => {
    filter = new GlobalErrorFilter();

    // Mock response object
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    // Mock request object
    mockRequest = {
      method: 'POST',
      url: '/api/v1/jobs',
    };

    // Mock ArgumentsHost
    mockArgumentsHost = {
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue(mockRequest),
        getResponse: jest.fn().mockReturnValue(mockResponse),
      }),
    } as unknown as ArgumentsHost;

    // Spy on logger methods
    loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    loggerWarnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Custom HttpException Handling', () => {
    it('should handle custom HttpException with all fields', () => {
      // Arrange
      const exception = new HttpException(
        'Invalid job payload',
        ErrorCode.VALIDATION,
        { field: 'payload', issue: 'must be an object' },
        HttpStatus.BAD_REQUEST,
      );

      // Act
      filter.catch(exception, mockArgumentsHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockResponse.json).toHaveBeenCalledWith({
        code: ErrorCode.VALIDATION,
        message: 'Invalid job payload',
        details: { field: 'payload', issue: 'must be an object' },
      });
    });

    it('should handle ValidationException', () => {
      // Arrange
      const exception = new ValidationException('Validation failed', {
        errors: ['error1', 'error2'],
      });

      // Act
      filter.catch(exception, mockArgumentsHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockResponse.json).toHaveBeenCalledWith({
        code: ErrorCode.VALIDATION,
        message: 'Validation failed',
        details: { errors: ['error1', 'error2'] },
      });
    });

    it('should handle NotFoundException', () => {
      // Arrange
      const exception = new NotFoundException('Job', 'abc-123');

      // Act
      filter.catch(exception, mockArgumentsHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
      expect(mockResponse.json).toHaveBeenCalledWith({
        code: ErrorCode.NOT_FOUND,
        message: "Job with identifier 'abc-123' not found",
        details: { resource: 'Job', identifier: 'abc-123' },
      });
    });

    it('should omit details if not provided', () => {
      // Arrange
      const exception = new HttpException(
        'Something went wrong',
        ErrorCode.INTERNAL_SERVER_ERROR,
        undefined,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );

      // Act
      filter.catch(exception, mockArgumentsHost);

      // Assert
      expect(mockResponse.json).toHaveBeenCalledWith({
        code: ErrorCode.INTERNAL_SERVER_ERROR,
        message: 'Something went wrong',
      });
    });
  });

  describe('NestJS HttpException Handling', () => {
    it('should map BAD_REQUEST to VALIDATION code', () => {
      // Arrange
      const exception = new NestHttpException('Bad request', HttpStatus.BAD_REQUEST);

      // Act
      filter.catch(exception, mockArgumentsHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockResponse.json).toHaveBeenCalledWith({
        code: ErrorCode.VALIDATION,
        message: 'Bad request',
      });
    });

    it('should map UNAUTHORIZED to UNAUTHORIZED code', () => {
      // Arrange
      const exception = new NestHttpException('Unauthorized', HttpStatus.UNAUTHORIZED);

      // Act
      filter.catch(exception, mockArgumentsHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
      expect(mockResponse.json).toHaveBeenCalledWith({
        code: ErrorCode.UNAUTHORIZED,
        message: 'Unauthorized',
      });
    });

    it('should map FORBIDDEN to FORBIDDEN code', () => {
      // Arrange
      const exception = new NestHttpException('Forbidden', HttpStatus.FORBIDDEN);

      // Act
      filter.catch(exception, mockArgumentsHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
      expect(mockResponse.json).toHaveBeenCalledWith({
        code: ErrorCode.FORBIDDEN,
        message: 'Forbidden',
      });
    });

    it('should map NOT_FOUND to NOT_FOUND code', () => {
      // Arrange
      const exception = new NestHttpException('Not found', HttpStatus.NOT_FOUND);

      // Act
      filter.catch(exception, mockArgumentsHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
      expect(mockResponse.json).toHaveBeenCalledWith({
        code: ErrorCode.NOT_FOUND,
        message: 'Not found',
      });
    });

    it('should map CONFLICT to CONFLICT code', () => {
      // Arrange
      const exception = new NestHttpException('Conflict', HttpStatus.CONFLICT);

      // Act
      filter.catch(exception, mockArgumentsHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
      expect(mockResponse.json).toHaveBeenCalledWith({
        code: ErrorCode.CONFLICT,
        message: 'Conflict',
      });
    });

    it('should handle NestHttpException with object response body', () => {
      // Arrange
      const responseBody = { statusCode: 400, message: 'Bad request', errors: ['error1'] };
      const exception = new NestHttpException(responseBody, HttpStatus.BAD_REQUEST);

      // Act
      filter.catch(exception, mockArgumentsHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockResponse.json).toHaveBeenCalledWith({
        code: ErrorCode.VALIDATION,
        message: 'Bad request', // Message from response body
        details: responseBody,
      });
    });

    it('should default to INTERNAL_SERVER_ERROR code for unmapped status codes', () => {
      // Arrange
      const exception = new NestHttpException(
        'Service Unavailable',
        HttpStatus.SERVICE_UNAVAILABLE,
      );

      // Act
      filter.catch(exception, mockArgumentsHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
      expect(mockResponse.json).toHaveBeenCalledWith({
        code: ErrorCode.INTERNAL_SERVER_ERROR,
        message: 'Service Unavailable',
      });
    });
  });

  describe('AppError Handling', () => {
    it('should handle AppError with details', () => {
      // Arrange
      const exception = new AppError('Database operation failed', ErrorCode.DATABASE_ERROR, {
        operation: 'insert',
        table: 'dtm_jobs',
      });

      // Act
      filter.catch(exception, mockArgumentsHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(mockResponse.json).toHaveBeenCalledWith({
        code: ErrorCode.DATABASE_ERROR,
        message: 'Database operation failed',
        details: { operation: 'insert', table: 'dtm_jobs' },
      });
    });

    it('should handle AppError without details', () => {
      // Arrange
      const exception = new AppError('Something went wrong', ErrorCode.INTERNAL_SERVER_ERROR);

      // Act
      filter.catch(exception, mockArgumentsHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(mockResponse.json).toHaveBeenCalledWith({
        code: ErrorCode.INTERNAL_SERVER_ERROR,
        message: 'Something went wrong',
      });
    });
  });

  describe('Generic Error Handling', () => {
    it('should handle standard Error objects', () => {
      // Arrange
      const exception = new Error('Unexpected error occurred');

      // Act
      filter.catch(exception, mockArgumentsHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(mockResponse.json).toHaveBeenCalledWith({
        code: ErrorCode.INTERNAL_SERVER_ERROR,
        message: 'Unexpected error occurred',
      });
    });

    it('should handle non-Error exceptions (e.g., string)', () => {
      // Arrange
      const exception = 'Something broke';

      // Act
      filter.catch(exception, mockArgumentsHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(mockResponse.json).toHaveBeenCalledWith({
        code: ErrorCode.INTERNAL_SERVER_ERROR,
        message: 'Internal server error',
      });
    });

    it('should handle null exceptions', () => {
      // Arrange
      const exception = null;

      // Act
      filter.catch(exception, mockArgumentsHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(mockResponse.json).toHaveBeenCalledWith({
        code: ErrorCode.INTERNAL_SERVER_ERROR,
        message: 'Internal server error',
      });
    });
  });

  describe('Logging Behavior', () => {
    it('should log with error level for 5xx status codes', () => {
      // Arrange
      const exception = new Error('Database connection lost');

      // Act
      filter.catch(exception, mockArgumentsHost);

      // Assert
      expect(loggerErrorSpy).toHaveBeenCalled();
      expect(loggerWarnSpy).not.toHaveBeenCalled();
      const logCall = loggerErrorSpy.mock.calls[0][0];
      expect(logCall).toContain('[POST]');
      expect(logCall).toContain('/api/v1/jobs');
      expect(logCall).toContain('500');
      expect(logCall).toContain('INTERNAL_SERVER_ERROR');
    });

    it('should log with warn level for 4xx status codes', () => {
      // Arrange
      const exception = new ValidationException('Invalid payload');

      // Act
      filter.catch(exception, mockArgumentsHost);

      // Assert
      expect(loggerWarnSpy).toHaveBeenCalled();
      expect(loggerErrorSpy).not.toHaveBeenCalled();
      const logCall = loggerWarnSpy.mock.calls[0][0];
      expect(logCall).toContain('[POST]');
      expect(logCall).toContain('/api/v1/jobs');
      expect(logCall).toContain('400');
      expect(logCall).toContain('VALIDATION');
      expect(logCall).toContain('Invalid payload');
    });

    it('should include stack trace in error logs', () => {
      // Arrange
      const exception = new Error('Critical failure');
      exception.stack = 'Error: Critical failure\n  at <stack trace>';

      // Act
      filter.catch(exception, mockArgumentsHost);

      // Assert
      expect(loggerErrorSpy).toHaveBeenCalled();
      const logCall = loggerErrorSpy.mock.calls[0][0];
      expect(logCall).toContain('Error: Critical failure');
      expect(logCall).toContain('at <stack trace>');
    });

    it('should handle exceptions without stack trace', () => {
      // Arrange
      const exception = 'String exception';

      // Act
      filter.catch(exception, mockArgumentsHost);

      // Assert
      expect(loggerErrorSpy).toHaveBeenCalled();
      const logCall = loggerErrorSpy.mock.calls[0][0];
      expect(logCall).toContain('"String exception"');
    });

    it('should include request details in logs', () => {
      // Arrange
      mockRequest.method = 'GET';
      mockRequest.url = '/api/v1/jobs/abc-123';
      const exception = new NotFoundException('Job', 'abc-123');

      // Act
      filter.catch(exception, mockArgumentsHost);

      // Assert
      expect(loggerWarnSpy).toHaveBeenCalled();
      const logCall = loggerWarnSpy.mock.calls[0][0];
      expect(logCall).toContain('[GET]');
      expect(logCall).toContain('/api/v1/jobs/abc-123');
      expect(logCall).toContain('404');
      expect(logCall).toContain('NOT_FOUND');
    });
  });

  describe('Response Format', () => {
    it('should always include code and message', () => {
      // Arrange
      const exception = new Error('Test error');

      // Act
      filter.catch(exception, mockArgumentsHost);

      // Assert
      const responseBody = mockResponse.json.mock.calls[0][0];
      expect(responseBody).toHaveProperty('code');
      expect(responseBody).toHaveProperty('message');
      expect(responseBody.code).toBeTruthy();
      expect(responseBody.message).toBeTruthy();
    });

    it('should conditionally include details only when present', () => {
      // Arrange
      const exceptionWithDetails = new HttpException(
        'Error with details',
        ErrorCode.VALIDATION,
        { key: 'value' },
        HttpStatus.BAD_REQUEST,
      );
      const exceptionWithoutDetails = new HttpException(
        'Error without details',
        ErrorCode.VALIDATION,
        undefined,
        HttpStatus.BAD_REQUEST,
      );

      // Act
      filter.catch(exceptionWithDetails, mockArgumentsHost);
      const responseWithDetails = mockResponse.json.mock.calls[0][0];

      mockResponse.json.mockClear();
      filter.catch(exceptionWithoutDetails, mockArgumentsHost);
      const responseWithoutDetails = mockResponse.json.mock.calls[0][0];

      // Assert
      expect(responseWithDetails).toHaveProperty('details');
      expect(responseWithoutDetails).not.toHaveProperty('details');
    });
  });

});
