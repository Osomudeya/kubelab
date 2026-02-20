/**
 * Helper functions for pod status → color mapping
 */

export const getPodStatusColor = (status) => {
  const statusLower = status?.toLowerCase() || 'unknown';
  
  switch (statusLower) {
    case 'running':
      return 'bg-green-100 text-green-800 border-green-200';
    case 'pending':
      return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    case 'failed':
    case 'crashloopbackoff':
    case 'error':
      return 'bg-red-100 text-red-800 border-red-200';
    case 'succeeded':
      return 'bg-blue-100 text-blue-800 border-blue-200';
    case 'terminating':
      return 'bg-gray-100 text-gray-800 border-gray-200';
    default:
      return 'bg-gray-100 text-gray-800 border-gray-200';
  }
};

export const getNodeStatusColor = (status) => {
  const statusLower = status?.toLowerCase() || 'unknown';
  
  switch (statusLower) {
    case 'true': // Ready
      return 'bg-green-100 text-green-800 border-green-200';
    case 'false': // Not Ready
      return 'bg-red-100 text-red-800 border-red-200';
    case 'unknown':
      return 'bg-gray-100 text-gray-800 border-gray-200';
    default:
      return 'bg-gray-100 text-gray-800 border-gray-200';
  }
};

export const getNodeRoleColor = (role) => {
  switch (role) {
    case 'control-plane':
      return 'bg-purple-100 text-purple-800 border-purple-200';
    case 'worker':
      return 'bg-blue-100 text-blue-800 border-blue-200';
    default:
      return 'bg-gray-100 text-gray-800 border-gray-200';
  }
};

