# Scripts reference (what to use vs ignore)

All scripts in [`scripts/`](../scripts/) stay in the repo — **do not delete** them from your clone unless you maintain a fork and know what you’re removing. They support different workflows; this page tells you **what to run** for a normal KubeLab lab.

## Running the lab

| Script | Use it? |
|--------|--------|
| **`deploy-all.sh`** | **Yes** — main way to deploy KubeLab to the cluster. |
| **`setup-cluster.sh`** | **Only if** you still need MicroK8s + addons on the VM (optional if you already set MicroK8s up yourself). |
| **`provision-worker-vms.sh`** | **Only if** you want extra worker VMs + join (multi-node / drain sims). |
| **`deploy-all-microk8s.sh`** | **Optional** — slimmer deploy; `deploy-all.sh` is the usual default. |
| **`join-worker-node.sh`** | **Only if** you join a worker manually (inside a worker VM); often replaced by `provision-worker-vms.sh`. |
| **`port-forward-grafana.sh`** | **Optional** — convenience; you can run `kubectl port-forward` yourself ([README port-forward table](../README.md#port-forwarding)). |
| **`deploy-observability.sh`** | **Optional** — deploys only observability; `deploy-all.sh` already includes that. |
| **`build-and-push.sh`** | **Only if** you build your own images (not needed for default public images). |
| **`update-manifests.sh`** | **Only if** you change image tags/names in manifests. |
| **`smoke-test.sh`** / **`test-local.sh`** | **Optional** — validation / local testing. |
| **`teardown.sh`** | **Optional** — cleanup helper when you want to tear things down. |

**Summary:** For a normal run you only **need** **`deploy-all.sh`**. Optionally use **`setup-cluster.sh`**, **`provision-worker-vms.sh`**, and the helpers above. **Don’t delete** the rest from the project — just ignore scripts you don’t need.

## Related

- [README — Quick start](../README.md#quick-start-for-new-users-microk8s--multipass)
- [MicroK8s cluster setup](../setup/k8s-cluster-setup.md)
- [Docker + image build](../setup/docker-setup.md)
