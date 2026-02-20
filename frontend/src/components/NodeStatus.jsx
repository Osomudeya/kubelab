/**
 * NodeStatus component
 * Cards showing each node's condition and capacity
 */

import { Server, Cpu, HardDrive, AlertCircle, CheckCircle } from 'lucide-react';
import { getNodeStatusColor, getNodeRoleColor } from '../utils/statusColors';

const NodeStatus = ({ nodes, isLoading }) => {
  if (isLoading) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-gray-200 rounded w-1/4"></div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[1, 2].map((i) => (
              <div key={i} className="h-32 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!nodes || nodes.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Nodes</h2>
        <p className="text-gray-500 text-center py-8">No nodes found</p>
      </div>
    );
  }

  const formatMemory = (bytes) => {
    if (!bytes) return 'N/A';
    const value = Number.parseInt(bytes, 10);
    if (value >= 1024 * 1024 * 1024) {
      return `${(value / (1024 * 1024 * 1024)).toFixed(1)} Gi`;
    }
    return `${(value / (1024 * 1024)).toFixed(0)} Mi`;
  };

  const formatCPU = (cpu) => {
    if (!cpu) return 'N/A';
    return cpu;
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Nodes</h2>
        <span className="text-sm text-gray-500">{nodes.length} total</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {nodes.map((node) => (
          <div
            key={node.name}
            className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow"
          >
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center">
                <Server className="w-5 h-5 text-gray-400 mr-2" />
                <div>
                  <div className="font-medium text-gray-900">{node.name}</div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {node.addresses?.find(a => a.type === 'InternalIP')?.address || 'N/A'}
                  </div>
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${getNodeRoleColor(
                    node.role
                  )}`}
                >
                  {node.role}
                </span>
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${getNodeStatusColor(
                    node.status
                  )}`}
                >
                  {node.status === 'True' ? (
                    <>
                      <CheckCircle className="w-3 h-3 mr-1" />
                      Ready
                    </>
                  ) : (
                    <>
                      <AlertCircle className="w-3 h-3 mr-1" />
                      Not Ready
                    </>
                  )}
                </span>
              </div>
            </div>

            {node.unschedulable && (
              <div className="mb-3">
                <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-yellow-100 text-yellow-800 border border-yellow-200">
                  Cordoned
                </span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 mt-3 pt-3 border-t border-gray-100">
              <div className="flex items-center text-sm">
                <Cpu className="w-4 h-4 text-gray-400 mr-2" />
                <div>
                  <div className="text-xs text-gray-500">CPU</div>
                  <div className="font-medium text-gray-900">
                    {formatCPU(node.allocatable?.cpu || node.capacity?.cpu)}
                  </div>
                </div>
              </div>
              <div className="flex items-center text-sm">
                <HardDrive className="w-4 h-4 text-gray-400 mr-2" />
                <div>
                  <div className="text-xs text-gray-500">Memory</div>
                  <div className="font-medium text-gray-900">
                    {formatMemory(node.allocatable?.memory || node.capacity?.memory)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default NodeStatus;

