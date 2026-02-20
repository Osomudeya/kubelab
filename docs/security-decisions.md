# Security Decisions

This document explains the security measures implemented in KubeLab and why they matter in production Kubernetes environments.

## Defense in Depth

KubeLab implements multiple security layers. This is called **defense in depth**—if one layer fails, others still protect the system. Think of it like a castle with multiple walls: outer walls, inner walls, and a keep.

## Layer 1: Pod Security Context

### What It Does

Every container in KubeLab runs with strict security constraints:

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 1000
  readOnlyRootFilesystem: true
  allowPrivilegeEscalation: false
  capabilities:
    drop:
      - ALL
```

### Why runAsNonRoot Matters

**The Problem**: Containers run as root (UID 0) by default. If a container is compromised, the attacker has root privileges.

**The Solution**: `runAsNonRoot: true` forces containers to run as a non-root user (UID 1000 in our case).

**What Happens Without It**:
- Attacker gains root access if container is compromised
- Can modify system files
- Can install malicious software
- Can access host resources
- Can escape to the host (in some configurations)

**Real-World Example**: In 2019, a cryptocurrency mining attack exploited containers running as root. The attacker installed mining software and used the compromised containers' resources. Running as non-root would have prevented this.

### Why readOnlyRootFilesystem Matters

**The Problem**: Containers can write to their filesystem. Malicious code can modify files, install backdoors, or corrupt data.

**The Solution**: `readOnlyRootFilesystem: true` makes the root filesystem read-only. Writable directories (like `/tmp`) are mounted as separate volumes.

**What Happens Without It**:
- Malicious code can modify application files
- Can install persistent backdoors
- Can corrupt configuration files
- Can write logs that hide attack traces

**Trade-off**: Some applications need to write files. We mount `/tmp` as an `emptyDir` volume for temporary files. This is a common pattern: read-only root, writable temp directories.

### Why allowPrivilegeEscalation: false Matters

**The Problem**: Even non-root users can sometimes escalate privileges using setuid binaries or kernel exploits.

**The Solution**: `allowPrivilegeEscalation: false` prevents privilege escalation, even if the container has capabilities.

**What Happens Without It**:
- Non-root user might escalate to root
- Kernel exploits become more dangerous
- Defense in depth is weakened

### Why Drop All Capabilities

**The Problem**: Linux capabilities grant specific privileges (like binding to ports < 1024, mounting filesystems). Containers rarely need these.

**The Solution**: `capabilities.drop: ALL` removes all Linux capabilities.

**What Happens Without It**:
- Containers have unnecessary privileges
- Attack surface increases
- Potential for privilege escalation

**Exception**: node-exporter needs `SYS_TIME` capability to read system time. This is explicitly added because it's required for the exporter's function.

## Layer 2: Resource Limits

### What They Do

Every container has CPU and memory limits:

```yaml
resources:
  limits:
    cpu: 200m
    memory: 256Mi
  requests:
    cpu: 100m
    memory: 128Mi
```

### Why Resource Limits Prevent Noisy Neighbors

**The Problem**: Without limits, one pod can consume all CPU/memory, starving other pods. This is called the "noisy neighbor" problem.

**The Solution**: Limits cap resource usage. Requests help the scheduler place pods appropriately.

**What Happens Without Limits**:
- One buggy pod consumes all CPU
- Other pods become unresponsive
- Node becomes unstable
- Scheduler can't make good placement decisions

**Real-World Example**: A memory leak in one pod causes it to consume all node memory. Other pods are evicted or become unresponsive. With limits, the leaky pod is killed when it exceeds its limit, protecting other pods.

### CPU Limits vs Requests

- **Requests**: Minimum guaranteed resources. Scheduler uses this for placement.
- **Limits**: Maximum allowed resources. Kubernetes throttles if exceeded.

**Example**: A pod with `requests: {cpu: 100m}` and `limits: {cpu: 200m}` is guaranteed 0.1 CPU cores and can burst to 0.2 cores if available.

### Memory Limits and OOM Kills

When a pod exceeds its memory limit, Kubernetes kills it (OOM kill). This is harsh but necessary—memory can't be throttled like CPU.

**What Happens**:
1. Pod exceeds memory limit
2. Kubernetes sends SIGTERM (graceful shutdown)
3. If pod doesn't terminate, SIGKILL after grace period
4. Pod restarts (if part of a Deployment)
5. Metrics show restart count increase

**Why This Matters**: Without limits, a memory leak could crash the entire node. Limits contain the damage to a single pod.

## Layer 3: Network Policies

### What They Do

Network Policies act like firewalls between pods:

```yaml
# Default: deny all
# Then: allow specific traffic
- Allow frontend → backend (port 3000)
- Allow backend → postgres (port 5432)
- Allow all → DNS (port 53)
```

### How NetworkPolicy Enforces Least Privilege

**The Problem**: By default, all pods can communicate with all other pods. If one pod is compromised, it can access everything.

**The Solution**: Network Policies enforce explicit allow rules. Everything else is denied.

**What Happens Without Network Policies**:
- Compromised frontend pod can access database directly
- Lateral movement is easy for attackers
- No network segmentation
- Difficult to contain breaches

**Real-World Example**: In 2017, a compromised web server in one namespace accessed a database in another namespace because no network policies were in place. Network policies would have blocked this.

### Default Deny All

Our first Network Policy denies all traffic:

```yaml
spec:
  podSelector: {}  # Applies to all pods
  policyTypes:
    - Ingress
    - Egress
```

Then we add specific allow rules. This is the **whitelist approach**—deny by default, allow explicitly.

**Why This Matters**: If you forget to add a Network Policy for a new service, it's isolated by default (secure by default). This is better than allowing everything and hoping you remember to restrict it.

## Layer 4: RBAC (Role-Based Access Control)

### What It Does

The backend ServiceAccount has limited Kubernetes API permissions:

```yaml
rules:
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "delete"]
  - apiGroups: [""]
    resources: ["nodes"]
    verbs: ["get", "list"]
```

### Why RBAC Limits Backend to Namespace Scope

**The Problem**: If the backend used cluster-admin credentials, a compromise would give attackers full cluster access.

**The Solution**: ServiceAccount with minimal permissions, scoped to the `kubelab` namespace.

**What Happens Without RBAC Limits**:
- Backend compromise = full cluster compromise
- Attacker can create/delete any resource
- Can access secrets in other namespaces
- Can modify cluster-wide resources
- Can create new namespaces and deploy malicious workloads

**Real-World Example**: In 2018, a compromised CI/CD system with cluster-admin access was used to mine cryptocurrency across the entire cluster. Limited RBAC would have contained the damage.

### Principle of Least Privilege

RBAC follows the **principle of least privilege**: grant only the minimum permissions needed.

**Our Backend Needs**:
- List pods (for cluster status)
- Get pod details (for status display)
- Delete pods (for kill-pod simulation)
- List nodes (for node status)

**Our Backend Doesn't Need**:
- Create namespaces
- Access secrets in other namespaces
- Modify cluster-wide resources
- Create ServiceAccounts
- Modify Network Policies

**Why This Matters**: Even if the backend is compromised, the attacker can only manipulate pods and nodes in the kubelab namespace. They can't access production workloads or cluster infrastructure.

## What Happens Without These Security Measures

### Scenario: Container Compromise

**Without Security Context**:
1. Attacker exploits vulnerability in application
2. Gains root access in container
3. Modifies system files
4. Installs backdoor
5. Escalates to host (in some cases)
6. Accesses other containers on the node

**With Security Context**:
1. Attacker exploits vulnerability
2. Gains non-root access (UID 1000)
3. Can't modify system files (read-only root)
4. Can't escalate privileges
5. Limited to application user permissions
6. Damage is contained

### Scenario: Network Compromise

**Without Network Policies**:
1. Frontend pod compromised
2. Attacker accesses database directly
3. Exfiltrates data
4. Accesses other services
5. Lateral movement across cluster

**With Network Policies**:
1. Frontend pod compromised
2. Can only access backend (explicitly allowed)
3. Can't access database directly (denied)
4. Can't access other services (denied)
5. Lateral movement blocked

### Scenario: API Compromise

**Without RBAC Limits**:
1. Backend ServiceAccount compromised
2. Attacker has cluster-admin access
3. Creates malicious workloads
4. Accesses all secrets
5. Modifies cluster configuration
6. Full cluster takeover

**With RBAC Limits**:
1. Backend ServiceAccount compromised
2. Attacker has limited namespace access
3. Can only manipulate kubelab namespace
4. Can't access other namespaces
5. Can't modify cluster-wide resources
6. Damage is contained to one namespace

## Security Best Practices Summary

1. **Always run as non-root**: Prevents privilege escalation
2. **Use read-only root filesystem**: Prevents file system tampering
3. **Drop all capabilities**: Minimizes attack surface
4. **Set resource limits**: Prevents resource exhaustion
5. **Implement Network Policies**: Enforces network segmentation
6. **Limit RBAC permissions**: Follows principle of least privilege
7. **Use ServiceAccounts**: Avoids using default service account
8. **Namespace isolation**: Separates workloads logically

## Production Considerations

In production, you'd also add:

- **Pod Security Standards**: Use Kubernetes Pod Security Standards (restricted profile)
- **Image Scanning**: Scan container images for vulnerabilities
- **Secrets Management**: Use external secret managers (Vault, etc.)
- **Network Encryption**: mTLS between services
- **Audit Logging**: Log all API access
- **Admission Controllers**: Validate and mutate resources before creation
- **Security Policies**: Use OPA/Gatekeeper for policy enforcement

KubeLab focuses on the fundamentals. Once you understand these, you can build on them with more advanced security measures.

## Learning Outcomes

After understanding these security decisions, you should be able to:

1. Explain why each security measure exists
2. Identify security gaps in Kubernetes deployments
3. Design secure pod specifications
4. Implement network segmentation
5. Configure appropriate RBAC permissions
6. Understand the consequences of missing security measures

Security isn't optional in production—it's essential. These patterns protect your applications, data, and infrastructure from real threats.

## Intentionally Insecure Elements (Lab Environment)

**Important**: KubeLab is a learning environment, not a production deployment. Some security measures are intentionally simplified or omitted for educational purposes:

1. **Default Grafana Credentials**: `admin/admin` - In production, use strong passwords and enable OAuth/SSO
2. **Simple PostgreSQL Password**: The database password is in a Kubernetes Secret but uses a simple value - In production, use a secrets manager (Vault, AWS Secrets Manager, etc.)
3. **No TLS/HTTPS**: Services communicate over HTTP - In production, all traffic should be encrypted with TLS
4. **No Image Scanning**: Docker images are not scanned for vulnerabilities - In production, scan all images before deployment
5. **No Pod Disruption Budgets**: No PDBs to ensure minimum availability during updates - In production, always define PDBs
6. **No Resource Quotas**: No namespace-level resource quotas - In production, set quotas to prevent resource exhaustion
7. **No Network Encryption**: NetworkPolicies control traffic but don't encrypt it - In production, use service mesh (Istio, Linkerd) for mTLS
8. **No Audit Logging**: No Kubernetes audit logs configured - In production, enable audit logging for compliance

**Why these simplifications?**
- Focus on core Kubernetes concepts without overwhelming complexity
- Allow beginners to understand fundamentals before advanced security
- Reduce setup time and complexity for learning purposes
- Make it easier to debug and understand what's happening

**Before using in production**, you must:
- Implement all security best practices
- Add TLS/HTTPS everywhere
- Use proper secrets management
- Enable audit logging
- Add pod disruption budgets
- Implement resource quotas
- Scan images for vulnerabilities
- Use a service mesh for mTLS
- Enable OPA/Gatekeeper policies
- Configure network encryption
