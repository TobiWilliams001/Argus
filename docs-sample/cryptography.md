# Applied Cryptography — Foundations

## What Cryptography Actually Is

Cryptography is the mathematical science of securing communication in the presence of adversaries. It is not security through obscurity — a cryptographic system must remain secure even if the adversary knows the algorithm. Only the keys are secret. This principle, known as Kerckhoffs's principle, is the foundation of modern cryptography.

## Symmetric Encryption

Symmetric encryption uses the same key to encrypt and decrypt data. The two parties must share the key in advance through a secure channel.

**AES (Advanced Encryption Standard)** is the gold standard for symmetric encryption. It operates on 128-bit blocks using key sizes of 128, 192, or 256 bits. AES-256 is used by the US government for top-secret information. The algorithm applies multiple rounds of substitution, permutation, and mixing operations. Each round uses a derived subkey from the original key through a process called the key schedule.

AES is a block cipher — it encrypts fixed-size blocks. To encrypt arbitrary-length data, it must be used with a mode of operation such as CBC (Cipher Block Chaining) or GCM (Galois/Counter Mode). GCM is preferred because it provides both encryption and authentication, detecting tampering.

**ChaCha20-Poly1305** is a modern alternative to AES-GCM, designed by Daniel Bernstein. It is faster in software on systems without hardware AES acceleration, which makes it the preferred cipher in mobile and embedded contexts. TLS 1.3 supports both AES-GCM and ChaCha20-Poly1305.

## Asymmetric Encryption

Asymmetric (public-key) cryptography uses a mathematically linked key pair: a public key that anyone can know, and a private key that only the owner knows. Data encrypted with the public key can only be decrypted with the private key. Conversely, data signed with the private key can be verified with the public key.

**RSA** relies on the mathematical difficulty of factoring the product of two large prime numbers. RSA-2048 requires factoring a 2048-bit number, which is computationally infeasible with current hardware and algorithms.

**Elliptic Curve Cryptography (ECC)** achieves equivalent security to RSA with much smaller key sizes. A 256-bit ECC key provides approximately the same security as a 3072-bit RSA key. The difficulty is the elliptic curve discrete logarithm problem. ECC is used in Bitcoin, TLS, and modern SSH.

## Hashing

A cryptographic hash function takes an input of arbitrary length and produces a fixed-size output called a digest. Hash functions must be: deterministic (same input always gives same output), fast to compute, preimage-resistant (cannot reverse the hash), and collision-resistant (cannot find two inputs with the same hash).

**SHA-256** produces a 256-bit hash and is used in Bitcoin's proof-of-work, TLS certificates, and Git's object model.

**bcrypt and Argon2** are password hashing functions. They are deliberately slow and memory-intensive to resist brute-force attacks. For storing user passwords, bcrypt or Argon2 should always be used instead of SHA-256.

## The Diffie-Hellman Key Exchange

Diffie-Hellman solves the key distribution problem: how can two parties establish a shared secret over an insecure channel without having met in advance? The protocol relies on the discrete logarithm problem. Both parties exchange public values derived from their private keys. They can each independently compute the same shared secret, but an eavesdropper who intercepts only the public values cannot compute the secret.

This is the foundation of TLS handshakes and Signal's messaging protocol.

## Zero-Knowledge Proofs

A zero-knowledge proof allows one party (the prover) to convince another party (the verifier) that a statement is true without revealing any information beyond the truth of the statement. For example, you can prove you know a password without revealing the password itself.

ZK proofs are increasingly used in blockchain privacy (Zcash, StarkNet), identity verification, and compliance systems where proving a fact without revealing underlying data is valuable.
