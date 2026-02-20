/**
 * React Query hook that polls /api/cluster/status with adaptive polling
 * Polls faster when data changes, slower when stable
 */

import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../services/api';

const fetchClusterStatus = async () => {
  const response = await api.get('/cluster/status');
  return response.data;
};

export const useClusterStatus = () => {
  const lastDataRef = useRef(null);
  const pollIntervalRef = useRef(3000); // Start with 3 seconds

  return useQuery({
    queryKey: ['clusterStatus'],
    queryFn: async () => {
      const data = await fetchClusterStatus();
      
      // Adaptive polling: if data changed, poll faster; if stable, poll slower
      const dataChanged = JSON.stringify(data) !== JSON.stringify(lastDataRef.current);
      if (dataChanged) {
        pollIntervalRef.current = 2000; // Poll every 2s when data changes
      } else {
        pollIntervalRef.current = Math.min(pollIntervalRef.current + 1000, 5000); // Gradually increase to max 5s
      }
      
      lastDataRef.current = data;
      return data;
    },
    refetchInterval: () => pollIntervalRef.current, // Use dynamic interval
    staleTime: 2000, // Consider data stale after 2 seconds
  });
};

