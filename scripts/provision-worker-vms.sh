#!/bin/bash

# Provision Multipass worker VMs and join them to an existing MicroK8s control plane.
# Run on your HOST — not inside a VM.
#
# Platforms:
#   - macOS / Ubuntu (and most Linux): yes — install Multipass from multipass.run, use bash.
#   - Windows: run with bash — Git Bash or WSL — not Windows PowerShell alone (this is a bash
#     script). Install Multipass for Windows; ensure `multipass` is on PATH inside that shell.
#     Use LF line endings for this file; CRLF can break the shebang / heredocs.
#
# Prerequisites:
#   - Multipass installed; control plane VM already has MicroK8s running (e.g. microk8s-vm).
#   - Workers use the same snap channel as the control plane (detected automatically).
#
# Usage:
#   ./scripts/provision-worker-vms.sh
#   CONTROL_VM=my-cp WORKER_VMS="w1 w2 w3" ./scripts/provision-worker-vms.sh
#
# Env (optional):
#   CONTROL_VM   — Multipass name of control plane (default: microk8s-vm)
#   WORKER_VMS   — space-separated worker VM names (default: kubelab-worker-{1,2,3})
#   MICROK8S_CHANNEL — override snap channel, e.g. 1.33/stable (default: read from control plane)
#   UBUNTU_RELEASE, WORKER_CPUS, WORKER_MEM, WORKER_DISK — passed to multipass launch

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

CONTROL_VM="${CONTROL_VM:-microk8s-vm}"
WORKER_VMS="${WORKER_VMS:-kubelab-worker-1 kubelab-worker-2 kubelab-worker-3}"
UBUNTU_RELEASE="${UBUNTU_RELEASE:-22.04}"
WORKER_CPUS="${WORKER_CPUS:-2}"
WORKER_MEM="${WORKER_MEM:-4G}"
WORKER_DISK="${WORKER_DISK:-20G}"

echo "🧩 KubeLab — provision worker VMs (Multipass + MicroK8s join)"
echo "=============================================================="
echo ""
echo "Control plane VM: $CONTROL_VM"
echo "Worker VM(s):     $WORKER_VMS"
echo ""

if ! command -v multipass &>/dev/null; then
    echo "❌ multipass not found. Install: https://multipass.run"
    exit 1
fi

vm_state() {
    multipass list --format csv | awk -F',' -v "n=$1" '$1==n {print $2}' | tr -d '\r'
}

if [ "$(vm_state "$CONTROL_VM")" != "Running" ]; then
    echo "❌ Control plane VM \"$CONTROL_VM\" is not Running."
    echo "   multipass start $CONTROL_VM"
    exit 1
fi

detect_channel() {
    if [ -n "${MICROK8S_CHANNEL:-}" ]; then
        echo "$MICROK8S_CHANNEL"
        return
    fi
    local tracking
    tracking=$(multipass exec "$CONTROL_VM" -- bash -lc "snap list microk8s 2>/dev/null | awk '/^microk8s / {print \$4}'" | tr -d '\r')
    if [ -z "$tracking" ]; then
        echo "❌ Could not detect MicroK8s snap channel on $CONTROL_VM. Set MICROK8S_CHANNEL, e.g. 1.33/stable"
        exit 1
    fi
    echo "$tracking"
}

CHANNEL="$(detect_channel)"
echo "📌 MicroK8s snap channel (workers will match): $CHANNEL"
echo ""

launch_if_missing() {
    local name="$1"
    local st
    st=$(vm_state "$name")
    if [ -z "$st" ]; then
        echo "🚀 Launching $name ($WORKER_CPUS CPUs, $WORKER_MEM RAM, $WORKER_DISK disk)..."
        multipass launch --name "$name" --cpus "$WORKER_CPUS" --memory "$WORKER_MEM" --disk "$WORKER_DISK" "$UBUNTU_RELEASE"
        echo "✅ $name created"
    elif [ "$st" != "Running" ]; then
        echo "▶️  Starting $name..."
        multipass start "$name"
    else
        echo "✅ $name already running"
    fi
}

install_microk8s_worker() {
    local vm="$1"
    echo ""
    echo "📦 Ensuring MicroK8s on $vm (channel $CHANNEL)..."
    multipass exec "$vm" -- env "CHANNEL=$CHANNEL" bash -s <<'WORKER_INSTALL'
set -euo pipefail
if command -v microk8s >/dev/null 2>&1; then
  echo "   MicroK8s already installed — skipping snap install"
else
  sudo snap install microk8s --classic --channel="${CHANNEL}"
  sudo usermod -a -G microk8s ubuntu || true
fi
sudo microk8s status --wait-ready
WORKER_INSTALL
    echo "✅ MicroK8s ready on $vm"
}

extract_join_args() {
    local out line
    # add-node prints instructions to stderr/stdout; capture both.
    out=$(multipass exec "$CONTROL_VM" -- sudo microk8s add-node 2>&1) || {
        echo "❌ microk8s add-node failed on $CONTROL_VM (is MicroK8s running?)"
        printf '%s\n' "$out"
        return 1
    }
    # Subshell disables pipefail so a grep "no match" exit 1 does not break $(...) under set -o pipefail.
    line=$(
        set +o pipefail
        printf '%s\n' "$out" | grep -E 'microk8s join ' | head -n 1
    )
    if [ -z "$line" ]; then
        echo "❌ Could not parse join command from: microk8s add-node"
        printf '%s\n' "$out"
        return 1
    fi
    printf '%s\n' "$line" | sed 's/.*microk8s join //' | tr -d '\r' | sed 's/[[:space:]]*$//'
}

join_worker() {
    local vm="$1"
    local join_args
    echo ""
    # Avoid UTF-8 / parentheses in one echo line (macOS /bin/bash 3.2 can mis-parse rare cases).
    printf '%s\n' "🔗 Joining $vm (fresh token from $CONTROL_VM)..."
    join_args=$(extract_join_args) || return 1
    if [ -z "$join_args" ]; then
        echo "❌ Empty join token"
        return 1
    fi
    multipass exec "$vm" -- sudo microk8s join "$join_args" --worker
    echo "✅ Join issued for $vm"
}

for w in $WORKER_VMS; do
    launch_if_missing "$w"
done

echo ""
echo "⏳ Installing / verifying MicroK8s on each worker (can take several minutes the first time)..."
for w in $WORKER_VMS; do
    install_microk8s_worker "$w"
done

echo ""
printf '%s\n' "🔗 Joining workers to cluster - one fresh token per worker, do not interrupt."
for w in $WORKER_VMS; do
    join_worker "$w"
    command sleep 5
done

echo ""
echo "✅ Done. On your host, run:"
echo "   kubectl get nodes -o wide"
echo ""
printf '%s\n' "You should see $CONTROL_VM plus each worker Ready."
printf '%s\n' "If join failed (token expired), run this script again. Workers already in the cluster may need: multipass shell <vm> then sudo microk8s leave"
echo ""
