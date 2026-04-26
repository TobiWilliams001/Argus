# Distributed Systems — Core Concepts

## What is a Distributed System?

A distributed system is a collection of independent computers that appear to users as a single coherent system. The computers communicate and coordinate their actions only by passing messages over a network. The key challenge is making this collection behave reliably even when individual components fail.

## The CAP Theorem

The CAP theorem, proven by Eric Brewer, states that a distributed data store can only guarantee two of the following three properties simultaneously:

**Consistency** — every read receives the most recent write or an error. All nodes in the system see the same data at the same time.

**Availability** — every request receives a response, although it may not be the most recent data. The system remains operational.

**Partition Tolerance** — the system continues operating even when network messages between nodes are lost or delayed.

In practice, since network partitions are unavoidable in real systems, engineers must choose between consistency and availability during a partition event. Systems like HBase and Zookeeper choose CP. Systems like Cassandra and DynamoDB choose AP.

## Consensus Algorithms

Consensus is the problem of getting multiple nodes to agree on a single value. This is surprisingly hard when nodes can crash or messages can be lost.

**Raft** is a consensus algorithm designed for understandability. It elects a leader node responsible for all writes. The leader replicates log entries to followers. A decision is committed once a majority of nodes acknowledge it. If the leader crashes, followers hold an election to choose a new leader. Raft is used in etcd, CockroachDB, and TiKV.

**Paxos** is the original consensus algorithm, proposed by Leslie Lamport. It is notoriously difficult to understand and implement correctly, but it is the theoretical foundation most distributed databases build on.

## Consistent Hashing

Consistent hashing is a technique for distributing data across nodes in a way that minimises data movement when nodes are added or removed. Instead of using `hash(key) mod N`, which requires redistributing almost all keys when N changes, consistent hashing maps both keys and nodes onto a circular ring. Each key is assigned to the nearest node clockwise on the ring. When a node joins or leaves, only the keys in its immediate neighbourhood are affected.

This is used by Cassandra, Dynamo, and most distributed caches.

## Replication Strategies

**Single-leader replication** — one node accepts all writes and replicates to followers. Simple but the leader is a bottleneck.

**Multi-leader replication** — multiple nodes accept writes. Increases write throughput but introduces write conflicts that must be resolved.

**Leaderless replication** — any node accepts writes. Uses quorums (write to W of N nodes, read from R of N nodes, where W + R > N) to ensure consistency. Used by Cassandra and Dynamo.

## The Two Generals Problem

The Two Generals Problem illustrates why it is impossible to achieve consensus over an unreliable network using only message passing. Two armies must coordinate an attack, but their only communication channel can lose messages. No finite exchange of messages can guarantee both generals will attack simultaneously. This problem proves that perfect reliability is impossible in distributed systems — engineers must design for partial failure.
