/**
 * React Query hook that polls /api/cluster/status.
 * When isSimulationActive is true, uses a fixed 2s interval for responsive Map/Events during sims.
 * Otherwise uses adaptive polling (faster when data changes, slower when stable).
 */

import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../services/api';

const fetchClusterStatus = async () => {
  const response = await api.get('/cluster/status');
  return response.data;
};

const SIM_ACTIVE_POLL_MS = 2000;

export const useClusterStatus = (isSimulationActive = false) => {
  const lastDataRef = useRef(null);
  const pollIntervalRef = useRef(3000);

  return useQuery({
    queryKey: ['clusterStatus'],
    queryFn: async () => {
      const data = await fetchClusterStatus();

      if (!isSimulationActive) {
        const dataChanged = JSON.stringify(data) !== JSON.stringify(lastDataRef.current);
        if (dataChanged) {
          pollIntervalRef.current = 2000;
        } else {
          pollIntervalRef.current = Math.min(pollIntervalRef.current + 1000, 5000);
        }
      }

      lastDataRef.current = data;
      return data;
    },
    refetchInterval: isSimulationActive ? SIM_ACTIVE_POLL_MS : () => pollIntervalRef.current,
    staleTime: 2000,
  });
};

