/**
 * Error Handling Middleware
 * 
 * Centralized error handling for Express API
 */

import { Request, Response, NextFunction } from 'express';
import { ApiResponse, ApiError, ApiErrorCode } from '../types/api';

/**
 * Custom error class with API error code
 */
export class AppError extends Error {
  constructor(
    public code: ApiErrorCode,
    message: string,
    public statusCode: number = 500,
    public details?: any
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Express error handling middleware
 * Catches all errors and formats them as ApiResponse
 * 
 * MUST be registered after all routes
 */
export function errorHandler(
  error: Error | AppError,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  console.error('[ErrorHandler] Error caught:', error);

  // Default error values
  let statusCode = 500;
  let errorCode = ApiErrorCode.INTERNAL_SERVER_ERROR;
  let message = 'An unexpected error occurred';
  let details: any = undefined;

  // Handle custom AppError
  if (error instanceof AppError) {
    statusCode = error.statusCode;
    errorCode = error.code;
    message = error.message;
    details = error.details;
  }
  // Handle validation errors
  else if (error.name === 'ValidationError') {
    statusCode = 400;
    errorCode = ApiErrorCode.VALIDATION_ERROR;
    message = error.message;
  }
  // Handle generic errors
  else {
    message = error.message || message;
  }

  // Build API error response
  const apiError: ApiError = {
    code: errorCode,
    message,
    details,
  };

  // Include stack trace in development mode only
  if (process.env.NODE_ENV === 'development' && error.stack) {
    apiError.stack = error.stack;
  }

  // Send response
  const response: ApiResponse = {
    success: false,
    error: apiError,
    meta: {
      timestamp: new Date().toISOString(),
    },
  };

  res.status(statusCode).json(response);
}

/**
 * Async route handler wrapper
 * Catches async errors and passes them to error handler
 * 
 * Usage:
 * app.get('/route', asyncHandler(async (req, res) => {
 *   // async code
 * }));
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * 404 Not Found handler
 * Should be registered after all routes but before error handler
 */
export function notFoundHandler(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const error = new AppError(
    ApiErrorCode.UNKNOWN_ERROR,
    `Route not found: ${req.method} ${req.path}`,
    404
  );
  next(error);
}
