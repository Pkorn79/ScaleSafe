/**
 * acceptblue.client.ts — accept.blue Payment API Client
 *
 * Wraps the accept.blue REST API v2 for payment processing.
 * Key details:
 * - Authentication: Basic Auth with the merchant's source key as username (no password)
 * - Each merchant has their own accept.blue account and API key
 * - Production: https://api.accept.blue/api/v2/
 * - Sandbox: https://api.sandbox.accept.blue/api/v2/
 *
 * This client handles charges, refunds, recurring schedules, and customer management.
 */

import axios, { AxiosInstance } from 'axios';
import { logger } from '../utils/logger';
import { ExternalServiceError } from '../utils/errors';
import { config } from '../config';

/** Creates an accept.blue API client configured for a specific merchant. */
export function createAcceptBlueClient(sourceKey: string): AxiosInstance {
  const baseURL = config.isProduction()
    ? 'https://api.accept.blue/api/v2'
    : 'https://api.sandbox.accept.blue/api/v2';

  const instance = axios.create({
    baseURL,
    auth: {
      username: sourceKey,
      password: '', // accept.blue uses source key as username, no password
    },
    headers: {
      'Content-Type': 'application/json',
    },
  });

  // Log all requests and responses for debugging
  instance.interceptors.response.use(
    (response) => {
      logger.debug(
        { url: response.config.url, status: response.status },
        'accept.blue API response'
      );
      return response;
    },
    (error) => {
      logger.error(
        {
          url: error.config?.url,
          status: error.response?.status,
          data: error.response?.data,
        },
        'accept.blue API error'
      );
      return Promise.reject(
        new ExternalServiceError(
          'accept.blue',
          error.response?.data?.message || error.message
        )
      );
    }
  );

  return instance;
}

/**
 * Convenience functions for common accept.blue operations.
 * Each function takes an authenticated client instance (created per-merchant).
 */

/** Creates a one-time charge. */
export async function createCharge(client: AxiosInstance, chargeData: Record<string, unknown>) {
  const response = await client.post('/transactions/charge', chargeData);
  return response.data;
}

/** Creates a credit/refund against a previous transaction. */
export async function createRefund(client: AxiosInstance, refundData: Record<string, unknown>) {
  const response = await client.post('/transactions/credit', refundData);
  return response.data;
}

/** Creates a recurring billing schedule for a customer. */
export async function createRecurringSchedule(
  client: AxiosInstance,
  customerId: number,
  scheduleData: Record<string, unknown>
) {
  const response = await client.post(
    `/customers/${customerId}/recurring-schedules`,
    scheduleData
  );
  return response.data;
}

/** Gets all recurring schedules for a customer (includes num_left, next_run_date). */
export async function getRecurringSchedules(client: AxiosInstance, customerId: number) {
  const response = await client.get(`/customers/${customerId}/recurring-schedules`);
  return response.data;
}

/** Creates a customer record in accept.blue. */
export async function createCustomer(client: AxiosInstance, customerData: Record<string, unknown>) {
  const response = await client.post('/customers', customerData);
  return response.data;
}

/** Pauses a recurring schedule (sets active=false). */
export async function pauseRecurringSchedule(client: AxiosInstance, scheduleId: number) {
  const response = await client.patch(`/recurring-schedules/${scheduleId}`, { active: false });
  return response.data;
}

/** Resumes a paused recurring schedule (sets active=true). */
export async function resumeRecurringSchedule(client: AxiosInstance, scheduleId: number) {
  const response = await client.patch(`/recurring-schedules/${scheduleId}`, { active: true });
  return response.data;
}

/** Cancels (deletes) a recurring schedule permanently. */
export async function cancelRecurringSchedule(client: AxiosInstance, scheduleId: number) {
  const response = await client.delete(`/recurring-schedules/${scheduleId}`);
  return response.data;
}
