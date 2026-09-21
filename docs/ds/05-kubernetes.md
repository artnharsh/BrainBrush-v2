# Unit IV: Kubernetes & Container Orchestration

## DS Concepts Covered
- **Distributed Web-Based Systems** — Multi-service web applications
- **Container Orchestration** — Automated management of containerized apps
- **Auto-Scaling** — Elastic scaling based on load
- **Service Discovery** — Finding services by name, not IP
- **Fault Tolerance** — Automatic recovery from failures

---

## Why Kubernetes?

Docker Compose is great for local development, but it lacks:
- **Auto-scaling**: Can't automatically add servers when load increases
- **Self-healing**: If a container crashes, Compose doesn't restart it intelligently
- **Rolling updates**: Can't update code without downtime
- **Service discovery**: Hardcoded hostnames in compose files

Kubernetes solves all of these with its **declarative** approach: you tell K8s the **desired state** (e.g., "I want 3 backend pods"), and it continuously works to maintain that state.

---

## BrainBrush Kubernetes Architecture

```
                    ┌─────────────────────────────┐
                    │         Ingress              │
                    │  (External Load Balancer)    │
                    │  - WebSocket sticky sessions │
                    │  - Path-based routing        │
                    └──────┬──────────┬───────────┘
                           │          │
                    /socket.io,     /
                    /auth, /api     (everything else)
                           │          │
                    ┌──────▼──────┐  ┌▼───────────────┐
                    │  Backend    │  │   Frontend      │
                    │  Service    │  │   Service       │
                    │ (ClusterIP) │  │  (ClusterIP)    │
                    └──────┬──────┘  └────────────────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
         ┌────▼───┐  ┌────▼───┐  ┌────▼───┐
         │ Pod 1  │  │ Pod 2  │  │ Pod 3  │  ← Managed by HPA
         │backend │  │backend │  │backend │     (3 → 10 pods)
         └────────┘  └────────┘  └────────┘
              │            │            │
              └────────────┼────────────┘
                           │
                    ┌──────▼──────┐
                    │   Redis     │
                    │   Service   │
                    │ (ClusterIP) │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │  Redis Pod  │
                    │ + PVC (1Gi) │
                    └─────────────┘
```

---

## Key Kubernetes Concepts → DS Mapping

### 1. Pods = Distributed Processes

A Pod is the smallest deployable unit in K8s. Each backend pod is a separate Node.js process, equivalent to a "node" in a distributed system.

```yaml
# k8s/backend.yaml
spec:
  replicas: 3  # Always maintain exactly 3 backend processes
```

**DS Concept:** Process replication — running multiple identical processes for fault tolerance and load distribution.

### 2. Services = Service Discovery & Naming

A Service provides a stable DNS name for a set of pods. Even as pods are created and destroyed, the service name stays the same.

```yaml
# backend-service resolves to whichever pods are running
apiVersion: v1
kind: Service
metadata:
  name: backend-service  # Other pods access backend via this name
spec:
  type: ClusterIP
  selector:
    app: brainbrush
    component: backend
  ports:
    - port: 5000
```

**DS Concept:** Location transparency — the Redis pod connects to `backend-service:5000`, not `10.244.0.15:5000`. If the pod's IP changes, the service updates automatically.

### 3. HPA = Elastic Auto-Scaling

The HorizontalPodAutoscaler monitors CPU usage and scales pods up/down automatically.

```yaml
# k8s/hpa.yaml
spec:
  minReplicas: 3
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          averageUtilization: 70  # Scale up when CPU > 70%
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 30    # React quickly
    scaleDown:
      stabilizationWindowSeconds: 300   # Wait 5 min before scaling down
```

**DS Concept:** Elastic scalability — the system adapts to demand without manual intervention.

### 4. Ingress = Reverse Proxy + Load Balancer

The Ingress routes external traffic to internal services with WebSocket support:

```yaml
# k8s/ingress.yaml
metadata:
  annotations:
    # Sticky sessions for WebSocket
    nginx.ingress.kubernetes.io/affinity: "cookie"
    nginx.ingress.kubernetes.io/session-cookie-name: "brainbrush-sticky"
```

**DS Concept:** This is the same reverse proxy concept as Nginx, but managed by Kubernetes.

### 5. Health Checks = Fault Detection

K8s continuously checks if pods are healthy. If a pod fails, it's automatically replaced.

```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 5000
  periodSeconds: 15     # Check every 15 seconds

readinessProbe:
  httpGet:
    path: /health
    port: 5000
  periodSeconds: 10     # Must be healthy before receiving traffic
```

**DS Concept:** Fault tolerance — failed processes are automatically detected and replaced without human intervention.

---

## Docker Compose vs Kubernetes

| Feature | Docker Compose | Kubernetes |
|---------|:-------------:|:----------:|
| Auto-scaling | ❌ Manual | ✅ HPA |
| Self-healing | ❌ Restarts only | ✅ Full replacement |
| Rolling updates | ❌ Downtime | ✅ Zero downtime |
| Service discovery | Hostname-based | DNS + ClusterIP |
| Secrets management | .env files | K8s Secrets (encrypted) |
| Resource limits | Optional | Enforced |
| Health checks | ❌ None | ✅ Liveness + Readiness |
| Best for | Development | Production |

We provide **both** in BrainBrush:
- `docker-compose.scaled.yml` → Quick demo, local development
- `k8s/*.yaml` → Production deployment, auto-scaling demo

---

## Deployment Commands

### Docker Compose (Quick Demo)
```bash
docker compose -f docker-compose.scaled.yml up --build
# Opens http://localhost with 3 backend instances
```

### Kubernetes (Full Orchestration)
```bash
# Create secrets first
kubectl create secret generic brainbrush-secrets \
  --from-literal=jwt-secret=your-jwt-secret \
  --from-literal=google-client-id=your-client-id \
  --from-literal=google-client-secret=your-client-secret

# Deploy everything
kubectl apply -f k8s/

# Watch pods come up
kubectl get pods -w

# Watch auto-scaling
kubectl get hpa -w

# Check logs from a specific pod
kubectl logs -f brainbrush-backend-xxxxx
```

---

## Demo Steps

### 1. Show Pod Replication
```bash
$ kubectl get pods
NAME                         READY   STATUS    RESTARTS
brainbrush-backend-abc12     1/1     Running   0
brainbrush-backend-def34     1/1     Running   0
brainbrush-backend-ghi56     1/1     Running   0
redis-xyz89                  1/1     Running   0
```

### 2. Show Fault Tolerance
```bash
# Kill a pod
$ kubectl delete pod brainbrush-backend-abc12

# K8s immediately creates a replacement
$ kubectl get pods -w
brainbrush-backend-abc12     1/1     Terminating   0
brainbrush-backend-jkl78     0/1     Pending       0
brainbrush-backend-jkl78     1/1     Running       0
```

### 3. Show Auto-Scaling
```bash
# Run load test → CPU spikes
$ kubectl get hpa -w
NAME                     TARGETS   MINPODS   MAXPODS   REPLICAS
brainbrush-backend-hpa   35%/70%   3         10        3
brainbrush-backend-hpa   82%/70%   3         10        3       ← Load spike!
brainbrush-backend-hpa   82%/70%   3         10        5       ← HPA scales up!
brainbrush-backend-hpa   45%/70%   3         10        5       ← Load drops
brainbrush-backend-hpa   45%/70%   3         10        3       ← HPA scales down
```
