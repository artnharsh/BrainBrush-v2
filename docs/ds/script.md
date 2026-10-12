# BrainBrush v2 — Complete Live Demo & Step-by-Step Runbook

This guide covers everything needed for your live demonstration: **Terraform**, **Ansible**, **Scaled 3-Backend Architecture on AWS**, **Scaled 3-Backend Architecture on your Laptop**, and **Local Kubernetes Auto-Scaling**.

---

## 🧠 Fundamental Concept: How Do We Have "3 Servers" on 1 Laptop or 1 EC2?

> **Key Rule of Distributed Systems:**  
> A "server" is **NOT a physical computer box**. A server is **an isolated software process** with its own memory, its own network port, and its own IP address.

```
       ┌────────────────────────────────────────────────────────┐
       │             YOUR LAPTOP (or 1 AWS EC2 Machine)          │
       │                                                        │
       │   Docker Virtual Network (Bridge: 172.20.0.x)          │
       │                                                        │
       │   ┌──────────────┐   ┌──────────────┐   ┌────────────┐ │
       │   │  Backend 1   │   │  Backend 2   │   │ Backend 3  │ │
       │   │  Container   │   │  Container   │   │ Container  │ │
       │   │  (Port 5000) │   │  (Port 5000) │   │ (Port 5000)│ │
       │   └──────┬───────┘   └──────┬───────┘   └─────┬──────┘ │
       │          │                  │                 │        │
       │          └──────────────────┼─────────────────┘        │
       │                             ▼                          │
       │                      ┌──────────────┐                  │
       │                      │    Redis     │                  │
       │                      │  Container   │                  │
       │                      └──────────────┘                  │
       └────────────────────────────────────────────────────────┘
```

1. Docker creates **3 isolated virtual environments (containers)** on the machine:
   - `brainbrush-backend-1`
   - `brainbrush-backend-2`
   - `brainbrush-backend-3`
2. Each backend runs its own independent Node.js process with its own private RAM.
3. They cannot communicate through shared memory—they can **only** communicate over the network through **Redis Pub/Sub** and **Nginx**.
4. **This IS a true Distributed System**, whether it runs on 1 laptop or 1 AWS EC2 instance!

---

## 🌐 The 3 Environments at a Glance

| Environment | Where It Runs | Tool Used | What Backends Are Running? |
|---|---|---|---|
| **1. Cloud AWS** | AWS EC2 (Ubuntu) | **Terraform + Ansible** | **3 scaled backends** (`backend-1`, `2`, `3`) behind Nginx |
| **2. Local Multi-Server** | Your Laptop | **Docker Compose** | **3 scaled backends** (`backend-1`, `2`, `3`) behind Nginx |
| **3. Local Kubernetes** | Your Laptop | **Minikube / Kubectl** | **3 to 10 backend pods** managed by HPA |

---

# 🚀 STAGE 1: Cloud AWS Live Demo (Terraform & Ansible)

> **Speaker Note:** *"Here is our cloud automation pipeline. We use Terraform to provision our AWS infrastructure as code, and Ansible to configure the server and deploy our 3 horizontally scaled backend instances behind Nginx."*

### Step 1.1: Provision AWS Infrastructure with Terraform
```bash
# Navigate to terraform directory
cd terraform

# 1. Initialize Terraform plugins
terraform init

# 2. Review the execution plan
terraform plan

# 3. Provision VPC, Subnet, Security Group, and EC2 instance
terraform apply -auto-approve

# 4. View your server's Public IP
terraform output
# Example output: ec2_public_ip = "3.6.88.7"

# Return to root directory
cd ..
```

---

### Step 1.2: Configure Ansible Inventory
Open `ansible/inventory.ini` and verify your EC2 public IP and private key path:
```ini
[servers]
<EC2_PUBLIC_IP> ansible_user=ubuntu ansible_ssh_private_key_file=/path/to/your-key.pem
```

Test that Ansible can reach the EC2 instance over SSH:
```bash
ansible -i ansible/inventory.ini servers -m ping
```
*Expected output:* `SUCCESS => { "ping": "pong" }`

---

### Step 1.3: Run Ansible Server Provisioning (`playbook.yml`)
This prepares the fresh Ubuntu machine by installing Docker Engine, Containerd, and Docker Compose:
```bash
ansible-playbook -i ansible/inventory.ini ansible/playbook.yml
```
**What Ansible does here:**
- Updates Ubuntu APT packages.
- Installs Docker GPG keys and official Docker repositories.
- Installs `docker-ce` and `docker-compose-plugin`.
- Adds `ubuntu` user to the docker group.
- Verifies `docker --version` and `docker compose version`.

---

### Step 1.4: Run Ansible Application Deployment (`deploy.yml`)
This deploys the **SCALED 3-backend application** to your AWS EC2 instance:
```bash
ansible-playbook -i ansible/inventory.ini ansible/deploy.yml
```
**What Ansible does here:**
- Copies `templates/docker-compose.prod.yml.j2` to `/home/ubuntu/brainbrush/docker-compose.yml`.
- Copies `templates/nginx.conf.j2` (with load-balancing upstream across 3 backends).
- Pulls pre-built production images from Docker Hub (`caliber001/brainbrush-*`).
- Runs `docker compose up -d`.
- Automatically executes a health check against `http://localhost/health`.

---

### Step 1.5: Verify the Scaled 3 Backends Running on AWS
```bash
# 1. SSH into the AWS server
ssh -i /path/to/your-key.pem ubuntu@<EC2_PUBLIC_IP>

# 2. Check the running containers on AWS
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
```
**Point out to examiner:** Show that on AWS, Docker is running **all 3 backend instances**:
- `brainbrush-nginx` (Port 80)
- `brainbrush-backend-1`
- `brainbrush-backend-2`
- `brainbrush-backend-3`
- `brainbrush-redis`
- `brainbrush-frontend`

Exit SSH:
```bash
exit
```

---

# 💻 STAGE 2: Local Scaled Demo (3 Backends on Your Laptop)

> **Speaker Note:** *"Now we run the exact same 3-backend architecture locally using Docker Compose to demonstrate our core Distributed Systems algorithms in real time."*

### Step 2.1: Start the Scaled Stack on Your Laptop
```bash
# Start all 6 containers locally
docker compose -f docker-compose.scaled.yml up -d --build

# Check that all 3 backend instances are healthy
docker compose -f docker-compose.scaled.yml ps
```

Open your browser at: **`http://localhost`**

---

### Step 2.2: Demo Feature 1 — Load Balancing & Instance Identification
Send requests to Nginx to inspect the load balancer routing:
```bash
# Test the health endpoint
curl -i http://localhost/health
```
**Point out to examiner:** Look at the `X-Instance-ID` HTTP header:
- Request 1 $\to$ `X-Instance-ID: backend-1`
- Open another terminal or browser $\to$ `X-Instance-ID: backend-2` or `backend-3`

---

### Step 2.3: Demo Feature 2 — Bully Election Algorithm (Unit III)
> **Concept:** When the room coordinator (host) disconnects, remaining players run the Bully Algorithm. Player priorities are tracked in a Redis Sorted Set. The highest priority player becomes the new host.

1. **Stream the election logs:**
   ```bash
   docker compose -f docker-compose.scaled.yml logs -f | grep -E "BullyElection|coordinator|Host disconnected"
   ```
2. **Inspect the Redis Sorted Set candidate pool:**
   ```bash
   # Open Redis CLI in the container
   docker exec -it brainbrush-redis redis-cli

   # View priority scores for your room (replace ROOM_CODE with your game code)
   ZREVRANGE room:ROOM_CODE:election 0 -1 WITHSCORES
   exit
   ```
3. **Trigger the election:**
   - In Browser 1 (Host), close the window or disconnect network.
   - **Result:** Within 2 seconds, Browser 2 receives a notification:  
     `"Host disconnected! Bully election in progress..."` $\to$ `"Player X has been elected as the new host!"`

---

### Step 2.4: Demo Feature 3 — Lamport Logical Clocks (Unit III)
> **Concept:** Backend server physical clocks drift (NTP skew). A draw in Round 1 on Server 1 and a draw in Round 2 on Server 2 could have out-of-order physical timestamps (`Date.now()`). We stamp every drawing segment with Lamport Logical Clock integers ($A \to B \implies C(A) < C(B)$).

1. In the browser, press `F12` $\to$ Click **Network** $\to$ Click **WS** (WebSockets) filter.
2. Click the active socket $\to$ Open the **Messages** tab.
3. Draw a line on the canvas.
4. **Show the examiner:** Expand the incoming `draw_line_batch` payload:
   ```json
   {
     "strokeId": "stroke_101",
     "points": [...],
     "lamportTimestamp": 1
   }
   ```
5. Draw another stroke: `lamportTimestamp` increments to `2`, `3`, `4`...  
   Explain: This monotonic logical counter guarantees total causal ordering regardless of network jitter or clock skew across our 3 instances.

---

### Step 2.5: Demo Feature 4 — WebRTC Push-to-Talk Voice Chat (Unit II)
> **Concept:** Node.js servers only handle signaling (SDP offer/answer and ICE candidates). Voice data streams peer-to-peer (P2P) between browsers to keep server CPU low.

1. In both browser windows, click **"Join Voice"**.
2. Hold the **"Hold to Talk"** button in Browser 1.
3. Show the active speaking indicator in Browser 2.

---

# ☸️ STAGE 3: Local Kubernetes Demo (Unit IV — Container Orchestration)

> **Speaker Note:** *"Now we demonstrate production container orchestration using Kubernetes on my local machine. This proves our application is cloud-native, declarative, self-healing, and supports Horizontal Pod Auto-scaling (HPA)."*

### Step 3.1: Start Minikube & Enable Required Addons
```bash
# 1. Start local Kubernetes cluster (allocates 4 CPUs, 4GB RAM)
minikube start --cpus=4 --memory=4096

# 2. Enable metrics-server (REQUIRED for CPU-based HPA auto-scaling)
minikube addons enable metrics-server

# 3. Enable Nginx Ingress Controller
minikube addons enable ingress
```

---

### Step 3.2: Create Kubernetes Secrets
```bash
# Create the secret used by the backend pods
kubectl create secret generic brainbrush-secrets \
  --from-literal=jwt-secret="demo_super_secret_jwt_key_12345" \
  --from-literal=google-client-id="demo_google_client_id" \
  --from-literal=google-client-secret="demo_google_client_secret"
```

---

### Step 3.3: Deploy All Kubernetes Manifests
```bash
# Apply deployments, services, ingress, and HPA
kubectl apply -f k8s/redis.yaml
kubectl apply -f k8s/mongo.yaml
kubectl apply -f k8s/backend.yaml
kubectl apply -f k8s/frontend.yaml
kubectl apply -f k8s/ingress.yaml
kubectl apply -f k8s/hpa.yaml

# Watch pods until they transition to Running (1/1)
kubectl get pods -w
```

---

### Step 3.4: Demo K8s Feature 1 — Pod Replication
```bash
kubectl get deployments,pods,services
```
**Point out:**
- `brainbrush-backend` deployment maintains **3 replicas** by default (`brainbrush-backend-xxxxx`).

---

### Step 3.5: Demo K8s Feature 2 — Self-Healing / Fault Tolerance
> **Speaker Note:** *"If an individual server container crashes, Kubernetes automatically detects the failure and replaces it instantly."*

1. Get the name of one backend pod:
   ```bash
   kubectl get pods -l app=brainbrush-backend
   ```
2. Delete that pod to simulate a sudden server crash:
   ```bash
   # Replace <POD_NAME> with one of your backend pod names
   kubectl delete pod <POD_NAME> & kubectl get pods -w
   ```
3. **Show the examiner:**
   - The targeted pod goes into `Terminating`.
   - Kubernetes immediately spins up a brand-new replacement pod (`Pending` $\to$ `Running`).
   - The total replica count stays at 3 with zero downtime!

---

### Step 3.6: Demo K8s Feature 3 — Horizontal Pod Auto-scaling (HPA)
> **Speaker Note:** *"When player traffic surges and backend CPU exceeds 70%, the Horizontal Pod Autoscaler dynamically scales the backend from 3 pods up to 10 pods."*

1. Open a terminal to monitor HPA in real time:
   ```bash
   kubectl get hpa brainbrush-backend-hpa -w
   ```
2. In a second terminal, launch a load generator to simulate a traffic spike:
   ```bash
   kubectl run load-generator -it --rm --image=busybox --restart=Never -- \
     /bin/sh -c "while true; do wget -q -O- http://brainbrush-backend:5000/health; done"
   ```
3. **Show the examiner:**
   - Watch the `TARGETS` column exceed 70% CPU.
   - Watch the `REPLICAS` column dynamically scale up: **3 $\to$ 5 $\to$ 7 $\to$ 10 pods**!
4. Stop the load generator (`Ctrl+C`).
   - Watch the CPU drop back down.
   - Note: K8s has a 300-second scale-down stabilization window to prevent rapid pod flapping.

---

### Step 3.7: Clean Up Kubernetes (After Demo)
```bash
kubectl delete -f k8s/
minikube stop
```

---

# 🧪 STAGE 4: Standalone Distributed Systems Lab Scripts

Run these standalone scripts to demonstrate your lab assignments:

### Lab 3: Deadlock Detection (Wait-For Graph DFS)
```bash
npx ts-node labs/deadlock-detection/deadlock.ts
```
* **What it proves:** Builds a directed Wait-For Graph (processes waiting on locks) and uses Depth-First Search (DFS) to detect circular wait conditions (deadlocks).

### Lab 5: MapReduce Word Count Simulation
```bash
npx ts-node labs/hadoop-wordcount/wordcount.ts
```
* **What it proves:** Simulates Apache Hadoop's distributed MapReduce workflow (**Map $\to$ Shuffle & Sort $\to$ Reduce**) across chat message logs.

---

# 🎯 Defense & Viva Questions (Cheat Sheet)

| Question | Winning Answer |
|---|---|
| **"How do you have 3 servers on 1 laptop or 1 EC2?"** | *"In distributed systems, a server is an isolated software process, not physical hardware. We use Docker containers with their own private memory and networking. They communicate exclusively over the network via Redis, making it a true distributed architecture."* |
| **"Is the scaled version on AWS or only local?"** | *"It is on both! Our Ansible deployment playbook (`deploy.yml`) runs the exact same 3 backend instances (`backend-1`, `backend-2`, `backend-3`) behind Nginx on the AWS EC2 instance."* |
| **"Why not run Kubernetes on EC2?"** | *"Our EC2 instance is a `t2.medium` with 4GB RAM. Running a K8s control plane (`etcd`, `apiserver`, `kubelet`) consumes ~1.5GB just for system overhead. We use Docker Compose on EC2 to keep cloud costs low, and run Kubernetes locally with Minikube to demonstrate HPA and self-healing."* |
| **"Why do we need Lamport Clocks if only 1 person draws per turn?"** | *"When turns hand off between rounds across different backend servers, physical NTP clock drift could cause Round 2's strokes to have older timestamps than Round 1. Lamport clocks preserve the happened-before relation ($A \to B \implies C(A) < C(B)$) across server boundaries."* |
| **"How does Redis Adapter prevent split-brain in Socket.IO?"** | *"When a player on Server 1 draws, Server 1 publishes the event to Redis. Redis Pub/Sub broadcasts it to Server 2 and Server 3, which emit it to their connected players. All state modifications (drawers, timers) are locked atomically in Redis."* |
