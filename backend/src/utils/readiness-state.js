/**
 * Shared readiness probe state.
 *
 * When fail-readiness simulation is active, the /ready endpoint returns 503.
 * Kubernetes removes this pod from Service endpoints — no new traffic reaches it.
 * The pod stays Running (liveness probe still passes). This demonstrates the
 * difference between a pod being ALIVE vs a pod ACCEPTING TRAFFIC.
 *
 * Auto-restores after the configured duration (default: 120 seconds).
 */

let _healthy = true;
let _failTimer = null;
let _failUntil = null;

module.exports = {
  isHealthy: () => _healthy,

  failFor: (ms) => {
    _healthy = false;
    _failUntil = Date.now() + ms;
    if (_failTimer) clearTimeout(_failTimer);
    _failTimer = setTimeout(() => {
      _healthy = true;
      _failTimer = null;
      _failUntil = null;
    }, ms);
  },

  restore: () => {
    _healthy = true;
    if (_failTimer) {
      clearTimeout(_failTimer);
      _failTimer = null;
    }
    _failUntil = null;
  },

  status: () => ({
    healthy: _healthy,
    failUntil: _failUntil,
    secondsRemaining: _failUntil
      ? Math.max(0, Math.ceil((_failUntil - Date.now()) / 1000))
      : 0,
  }),
};

