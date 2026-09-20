# BrainBrush Interview Q&A

## Q1: Project Architecture Explanation
**Context:** Explaining the architecture in a simple interview-style English, covering frontend, backend, WebSocket communication, database, and deployment.

**Answer:**
At a high level, BrainBrush uses a modern web stack designed for speed and real-time interactions. The frontend is a React Single Page Application, the backend is a Node.js microservice handling both HTTP and WebSockets, and I use a dual-database strategy with Redis and MongoDB to separate live game state from persistent data. Everything is containerized and deployed on AWS.

**Frontend:**
For the frontend, I used React 19 built with Vite for fast development and optimized production builds. To keep the UI fast and responsive while strokes are being drawn, I used Zustand for lightweight global state management. The client connects to the backend using the Socket.IO-client, which maintains the persistent connection needed to stream X/Y coordinates as a player draws.

**Backend:**
The backend is written in TypeScript using Node.js and Express. I use Express primarily to handle standard HTTP requests—like Google OAuth and fetching player history. The core of the game engine, however, runs entirely on the WebSocket layer.

**WebSocket Communication:**
Since this is a drawing game, standard HTTP is too slow. When a user draws, the frontend emits `draw_line` events containing the stroke data. The backend instantly broadcasts this to everyone else in the room. I optimized the system to hit a p95 latency of 43 ms and 1,500 events per second by keeping the WebSocket payload small and bypassing the main database entirely for live events.

**Database (Two-Tier Strategy):**
To support high concurrency, I split my data layer:
1. **Redis (In-Memory Data Store):** Used for transient data—active rooms, current game state, and timers. Because Redis reads/writes from memory, it handles intense loads easily.
2. **MongoDB:** Used purely for persistent data like user profiles and historical match stats.

**Infrastructure & Deployment:**
Both the frontend and backend are containerized using Docker. To provision the infrastructure, I used Terraform to spin up an AWS EC2 instance (Ubuntu) and configure the VPC and Security Groups.

---

## Q2: Handling 10,000 Concurrent Users
**Question:** If 10,000 users suddenly connect at the same time, what problems do you expect, and how would you scale your architecture to handle them?

**Answer:**
If 10,000 users connect instantly, the primary bottleneck will be server memory and CPU, as my current free-tier instance would quickly get overwhelmed. 

I would tackle this in two steps. First, the quickest fix is **vertical scaling**—simply upgrading to a higher-tier server with more RAM. 

However, the true solution is **horizontal scaling**. I would spin up multiple server instances using an Auto-Scaling Group and distribute the incoming traffic using Nginx or an AWS Application Load Balancer. 

Crucially, because this is a WebSocket application, I would also implement the **Socket.IO Redis Adapter**. This ensures that even if players in the same game room connect to completely different server instances, their drawing events are perfectly synced across the network.

---

## Q3: Redis Failure & Fault Tolerance
**Question:** Suppose Redis goes down while thousands of users are playing BrainBrush. What would happen, and how would you make the system more fault-tolerant?

**Answer:**
If Redis goes down, we lose all transient data. This means active game states, current room scores, and turn timers would be wiped out, causing active matches to abruptly drop. However, because of our two-tier database strategy, persistent user profiles and past match histories in MongoDB would remain perfectly safe.

To make the system fault-tolerant, I would implement two things:
First, I would set up **Redis High Availability** using a Primary-Replica architecture. If the main Redis node crashes, the system automatically fails over to a backup replica, so players barely notice a blip.
Second, I’d implement **graceful degradation** in the Node.js backend. Instead of the server crashing when Redis drops, the server would catch the error, temporarily pause the game, and send a 'reconnecting' message to the players via WebSockets.

---

## Q4: Restoring Paused Game State After Redis Crash
**Question:** But when the server is live again, will the paused game restore the previous state?

**Answer:**
It depends entirely on how you configured Redis.

By default, Redis operates purely in RAM. If it crashes, the memory is wiped clean. When the server comes back online, it wakes up completely empty. In this scenario, the paused game **cannot** be restored, and the match would be lost. 

However, you can solve this by enabling **Redis Persistence**—specifically a feature called **AOF (Append Only File)**. 

With AOF enabled, Redis continuously logs every game event to the hard drive in the background. If the Redis server crashes and restarts, it instantly reads that file, loads the exact game state back into memory, and your backend can seamlessly unpause the game right where the players left off.

---

## Q5: Understanding p95 Latency
**Question:** You mentioned a p95 latency of 43 ms earlier. What exactly does p95 latency mean, and why would you report p95 instead of just the average latency?

**Answer:**
There is a common misconception that p95 means 95% of requests are *successful*, but that is actually the "success rate." 

What p95 latency actually means is that **95% of all requests were completed in 43 milliseconds or less**. The remaining 5% of requests took longer than 43 ms.

The reason we report p95 (or p99) instead of the average is because **averages hide outliers**. For example, if 99 users have a 1 ms latency and 1 user has a 1000 ms latency, the average is about 11 ms. That sounds great, but it completely hides the fact that one user had a terrible, 1-second lag. 

By reporting a p95 latency of 43 ms, I am proving to the interviewer that the vast majority of my users are experiencing a consistently fast, smooth, real-time game, without hiding the worst-case scenarios.

---

## Q6: Authentication vs Authorization
**Question:** What is the difference between authentication and authorization? How did you handle both in BrainBrush?

**Answer:**
Authentication is about verifying *who* you are, while authorization is about verifying *what* you are allowed to do.

In BrainBrush, I handled **authentication** using Google OAuth 2.0 and Passport.js. When a user logs in, Google verifies their identity, and my backend issues a JSON Web Token (JWT) to securely maintain their session.

For **authorization**, I implemented strict checks across both the HTTP and WebSocket layers. On the HTTP side, my JWT middleware ensures a user can only access their own profile stats and history. More importantly, on the WebSocket side, I have strict game-logic authorization: only the room's host is allowed to trigger the 'start game' event, and during a round, only the currently active 'drawer' is authorized to broadcast drawing events to the rest of the room.

---

## Q7: Securing JWTs (Engineering Tradeoffs)
**Question:** You said your backend issues a JWT after Google OAuth authentication. Where do you store that JWT on the client, and how do you protect it from attacks such as XSS and CSRF? But firstly answer what is XSS and CSRF in short then proceed with the main answer.

**Answer:**
First, let me define the two attacks. **XSS (Cross-Site Scripting)** is when an attacker injects malicious JavaScript into your site to steal user data. **CSRF (Cross-Site Request Forgery)** is when a malicious site tricks a user's browser into sending an unwanted request to your backend.

When deciding where to store the JWT, I made a deliberate engineering tradeoff and chose **localStorage** over HttpOnly cookies. 

While HttpOnly cookies are technically more secure against XSS, they introduce massive CORS headaches across different ports and make it difficult to attach the token to WebSocket connections. Because BrainBrush is a low-stakes gaming SPA and not a banking app, localStorage was the pragmatic choice for fast WebSocket integration. 

To mitigate the **XSS** vulnerability, I rely on React's automatic sanitization of user inputs (like chat and guesses) so malicious scripts cannot be injected. As a massive bonus, using localStorage makes the app naturally immune to **CSRF** attacks! Because the browser doesn't automatically attach localStorage tokens to requests like it does with cookies, I manually inject the token into the Socket.IO payload (`socket.auth = { token }`), making CSRF impossible.

---

## Q8: WebSockets vs HTTP (Why WebSockets?)
**Question:** What is the difference between WebSockets and normal HTTP? Why did you choose WebSockets for BrainBrush instead of REST APIs or HTTP polling?

**Answer:**
Normal HTTP is unidirectional and stateless. The client sends a request, the server responds, and the connection closes. If the client wants new data, it has to ask again. WebSockets, on the other hand, provide a persistent, bi-directional connection. Once opened, both the client and server can push data to each other instantly without the overhead of constantly opening new connections.

I chose WebSockets for BrainBrush because it is a real-time drawing game. When a player draws a stroke, that X/Y coordinate needs to be broadcast to everyone in the room in milliseconds. 

If I used REST APIs with HTTP polling, every client would have to constantly bombard the server asking, "Is there a new stroke?" This creates massive network overhead due to HTTP headers and connection setups. By using WebSockets, I eliminated that overhead, which is exactly how I achieved my p95 latency of 43 ms and handled 1,500 events per second.

---

## Q9: How Node.js Handles Thousands of Connections (Single-Threaded)
**Question:** BrainBrush may have thousands of users connected through WebSockets simultaneously. Since Node.js is single-threaded, how can it handle thousands of concurrent connections without creating a separate thread for every user?

**Answer:**
Node.js handles this using an architecture called **asynchronous, non-blocking I/O**, powered by the **Event Loop**. 

A great way to visualize this is a restaurant. Node.js is like a single highly efficient waiter, while the database and network operations are the kitchen chefs. When a customer orders, the waiter hands the ticket to the kitchen and immediately goes to take the next customer's order. They don't stand around waiting. When the food is ready, the kitchen rings a bell (a callback), and the waiter delivers it.

Because of this, Node.js doesn't spawn a new heavy thread for every connected BrainBrush player. Instead, it delegates the network I/O to the operating system. The single Event Loop just listens for incoming WebSocket messages and fires off the game logic, which allows it to multiplex thousands of active connections simultaneously without running out of RAM.

---

## Q10: Blocking the Event Loop
**Question:** If Node.js can handle thousands of connections using the event loop, what happens if one BrainBrush operation performs a CPU-intensive task for 5 seconds on the main thread?

**Answer:**
If a CPU-intensive task runs for 5 seconds on the main thread, it **blocks the Event Loop**. 

Because Node.js is single-threaded, the Event Loop is the only thing processing incoming and outgoing events. If it is tied up doing heavy math or image processing for 5 seconds, the entire server effectively freezes. During that time, BrainBrush cannot process any other user's requests. No drawing strokes will be broadcast, chat messages won't deliver, and no new players can join. For thousands of connected users, the game will completely freeze for 5 seconds.

To prevent this, you should never run heavy CPU tasks on the main thread. Instead, you would offload that task to a **Worker Thread** (using Node's `worker_threads` module) or a separate background microservice, allowing the main Event Loop to continue processing real-time game events instantly.

---

## Q11: Horizontally Scaling WebSockets
**Question:** Suppose you horizontally scale BrainBrush to three Node.js servers. Player A is connected to Server 1 and Player B is connected to Server 2, but both players are in the same game room. Player A draws something. How does that drawing event reach Player B? Could you also explain how this differs from a normal application?

**Answer:**
This exact scenario is why you cannot horizontally scale WebSockets using a load balancer alone. 

In a normal web application (without WebSockets), if Server 1 needs to tell Server 2 something, it would directly use standard **Redis Pub/Sub**. Server 1 publishes a message, and Server 2 subscribes to read it and perhaps updates its local cache or database.

However, because BrainBrush uses WebSockets, we don't just want the *server* to know the message; we want the server to automatically push that message down to the *client's browser*. To solve this, we use the **Socket.IO Redis Adapter**.

Here is the exact flow:
1. Player A draws a line and sends the WebSocket event to Server 1.
2. Server 1's Redis Adapter receives the event and instantly **Publishes** it to a specific Redis channel tied to that game room.
3. Server 2 and Server 3's Adapters are actively **Subscribed** to that Redis channel. 
4. Redis instantly forwards the event to Server 2.
5. Server 2's Adapter intercepts the event from Redis, figures out which WebSockets are in the room, and pushes the event down to Player B.

Because Redis operates entirely in memory, this entire hop across servers happens in just a few milliseconds, ensuring the game stays perfectly synced in real-time.

---

## Q12: Redis Adapter vs Pub/Sub Mechanics and Failures
**Question:** Can you explain exactly how the Socket.IO Redis Adapter works, how standard Redis Pub/Sub works, and where both of them can fail?

**Answer:**
**Standard Redis Pub/Sub** is a "fire-and-forget" broadcasting system. When a publisher sends a message to a channel, Redis instantly delivers it to any currently active subscribers. 
* **Where it fails:** It offers absolutely **no delivery guarantees**. If a subscriber is offline, restarting, or crashes at the exact millisecond the message is sent, that subscriber completely misses the message. It is not queued or stored for later.

The **Socket.IO Redis Adapter** is a specialized bridge built *on top* of Redis Pub/Sub. When a developer calls `io.to("room").emit()`, the adapter intercepts the command, serializes the event data, and pushes it through Redis Pub/Sub. All other servers running the adapter receive the serialized event, deserialize it, and automatically fire their own local `io.to("room").emit()` commands.
* **Where it fails:** Because it relies entirely on Redis Pub/Sub, it inherits the exact same flaws. If your central Redis instance crashes, the adapters instantly lose connection, and players on different servers stop seeing each other's drawings. Furthermore, if a Node.js server briefly restarts, any WebSocket events broadcast by other servers during that downtime are permanently dropped and will never reach the clients on the restarted server.

---

## Q13: Redis Pub/Sub Message Loss
**Question:** You are using Redis Pub/Sub between your Socket.IO servers. What happens if Server 2 temporarily disconnects from Redis while Player A publishes 10 drawing events? When Server 2 reconnects, will Redis Pub/Sub give it those missed events?

**Answer:**
No, Redis Pub/Sub will **not** give Server 2 those missed events. 

As we discussed, Redis Pub/Sub is strictly a **fire-and-forget** messaging system. It does not store, queue, or log messages for subscribers that are currently offline or disconnected. 

If Server 2 temporarily disconnects from Redis, any messages published to the channel during that downtime are permanently lost to Server 2. When Server 2 reconnects, it only receives *new* messages published from that exact moment forward.

Because of this, Player B (who is connected to Server 2) will permanently miss those 10 drawing events. Their canvas will look incomplete compared to Player A's. To fix this, you would need to implement an event-sourcing mechanism or use a message broker with guaranteed delivery, like Kafka or RabbitMQ, instead of standard Redis Pub/Sub.

---

## Q14: Guaranteed Delivery Architecture
**Question:** If Redis Pub/Sub loses events when a server disconnects, tell me what technology or design you could use if you actually needed guaranteed delivery or replay of those missed events.

**Answer:**
If BrainBrush absolutely required guaranteed delivery or the ability to replay missed events, I would move away from standard Redis Pub/Sub and use one of these three architectures:

1. **Apache Kafka (Event Streaming):** Kafka writes all events to an ordered, persistent log on disk. If Server 2 crashes, Kafka safely stores the events. When Server 2 reconnects, it tells Kafka its last read "offset," and Kafka perfectly replays all missed events in the exact order they happened.
2. **RabbitMQ (Message Queuing):** RabbitMQ stores messages in queues and requires the consumer (Server 2) to send an 'Acknowledgment' (ACK) when it successfully processes an event. If Server 2 drops, it never sends the ACK, so RabbitMQ holds the messages in the queue and redelivers them when the server comes back online.
3. **Redis Streams:** If I wanted to stick to the Redis ecosystem, I would upgrade from Pub/Sub to Redis Streams. Unlike Pub/Sub, Streams actually persist messages. Server 2 can simply query the stream for all messages that arrived after its last known timestamp, fetching all missed drawing strokes.

---

## Q15: Database Selection (MongoDB vs PostgreSQL)
**Question:** You're storing persistent BrainBrush data in MongoDB. Why did you choose MongoDB instead of a relational database like PostgreSQL? What are the advantages and disadvantages of that decision? And also tell me why PostgreSQL instead of traditional SQL?

**Answer:**
**Why MongoDB over PostgreSQL?**
I chose MongoDB because it is a NoSQL document database, which provides incredible **schema flexibility**. For a game like BrainBrush, the structure of a 'match history' might change rapidly—we might want to start storing arrays of final drawings, chat logs, or new scoring metrics. With MongoDB, I can simply push JSON documents without having to write rigid schemas or run complex `ALTER TABLE` migrations. 
* **Advantages:** Rapid iteration, flexible schemas, handles unstructured game data beautifully, and scales horizontally very easily.
* **Disadvantages:** MongoDB struggles with deep relationships. If BrainBrush grew to have a complex social network (friend lists, guilds, microtransactions), doing complex `JOINS` across collections is slower and harder than in a relational database.

**Why PostgreSQL instead of other 'Traditional SQL' (like MySQL)?**
PostgreSQL *is* a traditional relational SQL database, but it is incredibly advanced. If I were to rebuild BrainBrush using an RDBMS, I would choose Postgres over MySQL primarily because of its **native JSONB support**. 

This feature allows you to have the strict, ACID-compliant relationships of traditional SQL (for users, passwords, and payments), while still storing flexible, unstructured JSON data (like game logs and X/Y drawing coordinates) in the exact same row. It gives you the best of both the NoSQL and SQL worlds in a single database.

---

## Q16: MongoDB Query Optimization & Indexes
**Question:** Suppose BrainBrush now has 10 million match-history documents, and fetching a user's recent matches becomes very slow. How would you diagnose and optimize that MongoDB query? Tell me what you'd do with indexes, and if you know it, mention what MongoDB's explain() can tell you.

**Answer:**
The very first thing I would do to diagnose the issue is run the query using MongoDB's **`explain('executionStats')`** method. 

The `explain()` output gives you a detailed breakdown of exactly how the database executed your query. The absolute most important metric I’d look for is whether it performed a **`COLLSCAN`** (Collection Scan). If it did, it means MongoDB had to read all 10 million documents one by one just to find a few matches, which is a massive performance killer.

To optimize it, I would create a **Compound Index**. Since the query asks for a specific user's *recent* matches, I would create an index on `{ userId: 1, createdAt: -1 }`. 

This fixes the problem in two ways:
1. The `userId: 1` portion allows the database to instantly jump to only the documents belonging to that specific user, completely eliminating the collection scan.
2. The `createdAt: -1` portion ensures those documents are pre-sorted by date in descending order, which completely avoids a very expensive, memory-heavy sorting operation before returning the results to the client.

---

## Q17: The Cost of Database Indexes
**Question:** If indexes make reads faster, why don't you simply create indexes on every MongoDB field?

**Answer:**
While indexes drastically speed up **reads**, they come with a massive penalty for **writes** and **storage**.

First, there is a **Write Penalty**. Every time you insert, update, or delete a document, MongoDB has to also update the underlying B-Tree data structures for every single index on that collection. If you have an index on every field, one simple database insert actually triggers dozens of write operations behind the scenes, completely crippling your database's write performance.

Second, there is a **Memory Cost**. For indexes to actually make your queries fast, the index data structure must live in your server's RAM. If you index every field, the size of your indexes will explode and exceed your available memory. When MongoDB runs out of RAM, it starts paging indexes back and forth to the hard drive, which completely destroys read performance anyway.

Therefore, you should only ever create indexes on fields that are frequently used in `find()` filters, `sort()` operations, or `join/lookup` queries.

---

## Q18: Containerization with Docker
**Question:** You said BrainBrush is containerized using Docker. Why did you use Docker? What problem does Docker solve that simply running `npm start` directly on your EC2 instance does not?

**Answer:**
The primary problem Docker solves is the classic **'It works on my machine'** dilemma. 

If I simply clone my code and run `npm start` on my EC2 instance, my application becomes heavily dependent on the host operating system. If I built the app on my local Mac using Node v20, but the EC2 instance is running an older Node v16, or if the EC2 instance is missing certain OS-level C++ build tools required by one of my node modules, the application will likely crash in production.

Docker solves this by **packaging the application code along with its entire environment**—the exact Node.js runtime, OS dependencies, and configurations—into a single, immutable Image.

This provides two massive benefits for BrainBrush:
1. **Environment Parity:** I can guarantee that if the Docker container runs successfully on my local laptop, it will run exactly the same way on my AWS EC2 instance.
2. **Horizontal Scalability & Rollbacks:** If I need to scale out to three servers, I don't need to manually SSH into each server, install Node, clone the repo, and run `npm install`. I simply pull the compiled Docker image and run it instantly. Furthermore, if a new deployment breaks, I can instantly roll back to the previous Docker image tag without having to debug what broke in the `npm` cache.

---

## Q19: Docker Images, Containers, and Data Persistence
**Question:** What is the difference between a Docker image and a Docker container? Also, what happens to data created inside a container when that container is deleted?

**Answer:**
**Image vs Container:**
The easiest way to understand the difference is through an object-oriented programming analogy. A **Docker Image** is like a Class—it is a read-only, immutable blueprint that contains your application code, libraries, and environment variables. A **Docker Container** is like an Object—it is a live, running instance of that Image. You can spin up ten identical, running Containers from a single Image.

**Data Persistence (The Problem):**
By default, Docker containers are **ephemeral** (temporary). If you run a MongoDB database inside a container, write 1,000 BrainBrush game records to it, and then that container crashes or is deleted, all 1,000 records are **permanently destroyed**. The data dies with the container.

**The Solution:**
To prevent this, you must use **Docker Volumes**. A Volume acts as a bridge, mapping a directory inside the ephemeral container to a safe, persistent directory on the host EC2 machine's hard drive. With a Volume attached, even if the MongoDB container is completely deleted, the database files remain perfectly safe on the EC2 machine, ready to be attached to a brand new container.

---

## Q20: AWS Security Groups and Port Exposure
**Question:** You deployed BrainBrush on an AWS EC2 instance. What is an AWS Security Group, and which ports would you expose for your application? Would you expose your Node.js port, MongoDB port, or Redis port directly to the public internet?

**Answer:**
**AWS Security Groups:**
An AWS Security Group acts as a virtual firewall for your EC2 instance. It controls exactly what inbound and outbound network traffic is allowed to reach your server. By default, it blocks all inbound traffic.

**Which Ports to Expose:**
When configuring my Security Group for BrainBrush, I follow the **Principle of Least Privilege**.

The **only** ports I expose directly to the public internet (0.0.0.0/0) are:
1. **Port 80 (HTTP)**
2. **Port 443 (HTTPS)**
3. *(Optionally)* **Port 22 (SSH)**, but strictly limited to my personal laptop's IP address, never to the whole internet.

**Node, MongoDB, and Redis:**
I would **never** expose my Node.js port (e.g., 3000), MongoDB port (27017), or Redis port (6379) directly to the public internet. 

Exposing a database port publicly is the number one cause of cloud data breaches. Instead, I run a reverse proxy like Nginx that listens on the public ports 80/443. When a user sends a request, Nginx securely routes that traffic internally to the Node.js container on port 3000. 

Meanwhile, MongoDB and Redis are completely isolated on a private virtual network. They are configured to reject all external traffic and will *only* accept internal connections coming directly from the Node.js backend.
