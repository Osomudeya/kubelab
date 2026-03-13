/**
 * Axios instance configured for backend API
 */

import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor: ensure JSON body requests always send Content-Type (avoids 415 behind proxies)
api.interceptors.request.use(
  (config) => {
    const method = (config.method || 'get').toLowerCase();
    if (['post', 'put', 'patch'].includes(method) && config.data !== undefined) {
      if (!config.headers) config.headers = {};
      if (!config.headers['Content-Type']) {
        config.headers['Content-Type'] = 'application/json';
      }
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    if (error.response) {
      // Server responded with error status
      return Promise.reject({
        message: error.response.data?.error || error.response.statusText || 'An error occurred',
        status: error.response.status,
        data: error.response.data,
      });
    } else if (error.request) {
      // Request made but no response received
      return Promise.reject({
        message: 'No response from server. Please check your connection.',
        status: 0,
      });
    } else {
      // Error setting up request
      return Promise.reject({
        message: error.message || 'An unexpected error occurred',
        status: 0,
      });
    }
  }
);

export default api;

