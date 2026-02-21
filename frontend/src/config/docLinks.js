/**
 * Base URL for docs (GitHub blob or any deployed docs root).
 * Override with VITE_DOCS_BASE in .env for a fork or custom docs host.
 */
const REPO_DOCS_BASE =
  import.meta.env?.VITE_DOCS_BASE != null
    ? String(import.meta.env.VITE_DOCS_BASE).replace(/\/$/, '')
    : 'https://github.com/Osomudeya/kubelab/blob/main';

export const docLinks = {
  interviewPrep: `${REPO_DOCS_BASE}/docs/interview-prep.md`,
  simulationsBase: `${REPO_DOCS_BASE}/docs/simulations`,
  setupCluster: `${REPO_DOCS_BASE}/setup/k8s-cluster-setup.md`,
};
