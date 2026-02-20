/**
 * PodTable component
 * Live table of pods with status, restarts, and node placement
 */

import { Clock, Server, Activity } from 'lucide-react';
import { getPodStatusColor } from '../utils/statusColors';

const PodTable = ({ pods, isLoading }) => {
  if (isLoading) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-gray-200 rounded w-1/4"></div>
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-12 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!pods || pods.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Pods</h2>
        <p className="text-gray-500 text-center py-8">No pods found</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Pods</h2>
        <span className="text-sm text-gray-500">{pods.length} total</span>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Name
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Node
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Containers
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Age
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {pods.map((pod) => {
              const age = pod.createdAt
                ? Math.floor((new Date() - new Date(pod.createdAt)) / 1000 / 60)
                : 0;
              const readyContainers = pod.containers?.filter(c => c.ready).length || 0;
              const totalContainers = pod.containers?.length || 0;

              return (
                <tr key={`${pod.namespace}-${pod.name}`} className="hover:bg-gray-50">
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center">
                      <Activity className="w-4 h-4 text-gray-400 mr-2" />
                      <div>
                        <div className="text-sm font-medium text-gray-900">{pod.name}</div>
                        <div className="text-xs text-gray-500">{pod.namespace}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${getPodStatusColor(
                        pod.status
                      )}`}
                    >
                      {pod.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center text-sm text-gray-900">
                      <Server className="w-4 h-4 text-gray-400 mr-1" />
                      {pod.nodeName || 'N/A'}
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                    {readyContainers}/{totalContainers} ready
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center text-sm text-gray-500">
                      <Clock className="w-4 h-4 mr-1" />
                      {age < 60 ? `${age}m` : `${Math.floor(age / 60)}h`}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default PodTable;

