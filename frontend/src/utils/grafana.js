/**
 * Grafana URL for the current environment.
 * - localhost or port 8080 → port 3000 (port-forward)
 * - node IP → port 30300 (NodePort)
 */
const GRAFANA_NODEPORT = 30300;
const GRAFANA_PORT_FORWARD_PORT = 3000;

export function getGrafanaUrl() {
  const loc = typeof globalThis.location !== 'undefined' ? globalThis.location : { hostname: 'localhost', port: '8080' };
  const hostname = loc.hostname;
  const port = loc.port || '';
  const usePortForward = hostname === 'localhost' || hostname === '127.0.0.1' || port === '8080';
  const grafanaPort = usePortForward ? GRAFANA_PORT_FORWARD_PORT : GRAFANA_NODEPORT;
  return `http://${hostname}:${grafanaPort}`;
}
