# Skufia-Net Development Roadmap

This document outlines the strategic technical goals and planned features for the Skufia-Net project.

## 🟢 Current Sprint (In Progress)
The current focus is on finalizing Enterprise-Grade security and stability features (Managed by autonomous Jules agents).
- **End-to-End Encryption (E2EE):** Implementation of public key exchange and AES key wrapping using `RoomKeyBundle`.
- **Private Groups UI:** Invites and role management for private group channels.
- **Rate Limiting & Anti-Spam:** Redis-backed rate limiting to protect the FastAPI backend.
- **Active Session Management:** Implementation of JWT-based session tracking, allowing users to revoke active sessions across devices.
- **Testing:** Comprehensive UI and integration testing of the above features once merged.

## 🟡 Next Sprint (Planned)
- **Blue-Green Deployment:** Execute `scratch/blue_green_deploy.sh` to transition to the new zero-downtime Nginx infrastructure.
- **Premium UI Refinements:** Implement the localized "Premium Messenger Mockup" applying exact glassmorphism color schemes based on the provided UI Map.

## 🔴 Future Architecture Upgrade: Perfect Forward Secrecy (PFS)
Once the base RSA/AES encryption is stable, the system will be upgraded to support **Perfect Forward Secrecy (PFS)** via the Signal Protocol approach. 

**Requirements for PFS:**
1. **ECDHE (Elliptic-Curve Diffie-Hellman Ephemeral):** Replace classic DHE and RSA key wrapping with `Curve25519` (or `P-256`) for faster and more secure key agreements.
2. **MITM Protection (X3DH):** Use long-term `Identity Keys` (EdDSA/RSA) to cryptographically sign medium-term `Signed Pre-Keys` and `One-Time Pre-Keys` to guarantee authenticity.
3. **KDF (HKDF):** Pass the raw ECDH shared secret through an HMAC-based Key Derivation Function (HKDF) before using it as a 256-bit AES encryption key.
4. **Double Ratchet:** Rotate keys per message to provide both Forward Secrecy (protecting past messages) and Post-Compromise Security (recovering channel security after a breach).

*Note: The detailed implementation plan and schema changes for PFS are documented in the `skufia_pfs_architecture.md` artifact.*
