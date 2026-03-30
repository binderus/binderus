import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from 'axios';
import useSWR, { SWRConfiguration } from 'swr';
import { stringify } from 'query-string';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isWeb } from './base-utils';

export const API_BASE = 'http://localhost:9090';
const HTTP_UNAUTHORIZED = 401;
const HTTP_TOO_MANY_REQUESTS = 429;

/** Unified fetch — uses native fetch on web, Tauri HTTP plugin on desktop. */
export const httpFetch = (url: string, options?: RequestInit): Promise<Response> =>
  isWeb ? fetch(url, options) : tauriFetch(url, options);

const errorToast = (message: string) => {
  console.error(message);
};

export const isStatusOK = (response: ApiResponse) => {
  return response.status >= 200 && response.status < 300;
};

// eslint-disable-next-line
const buildQueryString = (queryObj: any) => (queryObj ? '?' + stringify(queryObj) : '');

const axiosApi: AxiosInstance = axios.create({
  headers: {}
});

export const sleep = (ms: number) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

export const dummyFetch = async (mockData = []) => {
  await sleep(1000);
  return mockData;
};

// eslint-disable-next-line
const catchError = (err: any) => {
  const errorObj = err as Error | AxiosError;
  const errorData = { message: typeof err === 'object' ? err?.message : err, errorResponse: '' };

  if (axios.isAxiosError(errorObj)) {
    // some APIs return response when an error occurred (status !== 200)
    // NOTE: added <string> to get around lint errors, not tested, not sure if it works
    errorData.errorResponse = (errorObj as AxiosError<string>).response?.data ?? '';
  }
  console.error('catchError', err, err?.response);
  return { error: errorData, status: err?.response?.status };
};

export const getAuthHeaders = async () => {
  return {};
};

interface ApiParams {
  query?: unknown; // query object - will be converted to query string (?param1=value1&param2=value2...).
  data?: unknown; // data (payload) for Post, Put, Delete
  options?: AxiosRequestConfig;
  requiresAuth?: boolean;
  doNotAttemptLogin?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ApiError = any;

export interface ApiResponse {
  error?: ApiError;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result?: any;
  status: number;
}

// example: const { result, error, status } = await apiGet(`/api/path`, { query: { page: 1 } });
export const apiGet = async (path: string, params?: ApiParams): Promise<ApiResponse> => {
  const queryStr = buildQueryString(params?.query);

  try {
    const userEndpointRegex = /\/(u|user)\//;
    const publicUserEndpoint = /\/p\/u\//;
    let requiresAuth = userEndpointRegex.test(path) && !publicUserEndpoint.test(path);
    if (params?.requiresAuth === true) {
      requiresAuth = true;
    }

    let authHeaders = {};
    if (requiresAuth) {
      authHeaders = await getAuthHeaders();
    }

    const { data, status } = await axiosApi({
      url: path.startsWith('http') ? path : `${API_BASE}${path}${queryStr}`,
      method: 'GET',
      headers: authHeaders,
      ...params?.options
    });
    return { result: data, status };
  } catch (err) {
    const { error, status } = catchError(err);
    if (status === HTTP_UNAUTHORIZED) {
      errorToast('Unauthorized');
      return { error: new Error('Unauthorized'), status };
    }
    return { error, status };
  }
};

// example: const { result, error, status } = await apiPost(`/api/path`, { data: { somekey: 'somevalue' } });
export const apiPost = async (path: string, params?: ApiParams): Promise<ApiResponse> => {
  const queryStr = buildQueryString(params?.query);
  const headers = await getAuthHeaders();
  try {
    const { data, status } = await axiosApi({
      url: `${API_BASE}${path}${queryStr}`,
      method: 'POST',
      headers,
      data: params?.data,
      ...params?.options
    });

    return { result: data, status };
  } catch (err) {
    const { error, status } = catchError(err);

    if (status === HTTP_TOO_MANY_REQUESTS) {
      errorToast("You've been rate limited, please try again in a few minutes");
    }
    return { error, status };
  }
};

// same as apiPost but with PUT method.
export const apiPut = (path: string, params?: ApiParams) => {
  return apiPost(path, { ...params, options: { ...params?.options, method: 'PUT' } });
};

export const apiDelete = async (path: string, params?: ApiParams): Promise<ApiResponse> => {
  const queryStr = buildQueryString(params?.query);
  const headers = await getAuthHeaders();
  try {
    const { data, status } = await axiosApi({
      url: `${API_BASE}${path}${queryStr}`,
      method: 'DELETE',
      headers,
      data: params?.data,
      ...params?.options
    });
    return { result: data, status };
  } catch (err: Error | unknown) {
    const { error, status } = catchError(err);
    return { error, status };
  }
};

// helper fn for 'useFetch'
export const swrFetch = async (path: string, apiParams?: ApiParams) => {
  const { result, error } = await apiGet(path, apiParams);
  if (error) {
    throw new Error('Error completing request');
  }
  return result;
};

// useFetch - example: const { result, error, isLoading } = useFetch<{ data: User[] }>(`https://fakerapi.it/api/v1/persons`);
interface useFetchParams {
  query?: unknown;
  swrOptions?: SWRConfiguration<unknown> | undefined;
  apiParams?: ApiParams;
  [key: string]: unknown;
}
export const useFetch = <T>(path: string | null, params: useFetchParams = {}) => {
  const queryStr = buildQueryString(params?.query);
  const options = {
    errorRetryCount: 0,
    revalidateOnFocus: false,
    ...params?.swrOptions
  };
  const { data, error, mutate } = useSWR(
    path ? `${path}${queryStr}` : null,
    (path) => swrFetch(path, params.apiParams),
    options
  );
  return {
    result: error ? null : (data as T),
    isLoading: !error && !data,
    isError: !!error,
    mutate,
    error
  };
};
