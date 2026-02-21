# Grafana login failed — reset admin password

If you see **"Invalid username or password"** with `admin` / `kubelab-grafana-2026`, Grafana’s database was probably created with a different password (e.g. an older secret or default). The secret in `k8s/secrets.yaml` is only applied when Grafana initializes its DB for the first time.

**Reset the admin password to match the docs:**

```bash
kubectl exec -n kubelab deployment/grafana -- grafana-cli admin reset-admin-password kubelab-grafana-2026
```

Then log in at http://localhost:3000 with:

- **Email or username:** `admin`
- **Password:** `kubelab-grafana-2026`

If the CLI isn’t in the image path, try:

```bash
kubectl exec -n kubelab deployment/grafana -- /usr/share/grafana/bin/grafana-cli admin reset-admin-password kubelab-grafana-2026
```

After that, restart Grafana so it picks up the change cleanly:

```bash
kubectl rollout restart deployment/grafana -n kubelab
```

Wait for the new pod to be Ready, then try logging in again.
